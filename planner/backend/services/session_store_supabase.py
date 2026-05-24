"""
Supabase-backed session store — Phase 2 Step 2.

Makes editor/planning sessions survive Railway restarts. It SUBCLASSES
``InMemorySessionStore`` so the live in-memory dict stays the working copy:
every existing callsite in app.py keeps mutating ``store.get(sid)`` in place
under ``store.lock`` exactly as before, and the non-serializable runtime state
(``sse_clients`` — gevent queues) keeps living in memory. Supabase is a
write-through + periodic-flush persistence layer underneath:

  * create()  — build the in-memory session (super), then push the immutable
                blobs (.miz bytes + mission Lua) to Storage and upsert the
                metadata/state row.
  * get()     — return the cached session; on a miss (e.g. right after a
                restart) HYDRATE it back from Supabase, rebuilding sse_clients
                empty. Returns None only if it's not in Supabase either.
  * delete()  — drop from cache (super) and remove the row + storage objects.
  * cleanup() — expire from cache (super) and delete expired rows/objects.
  * a background thread flushes changed session *state* every few seconds, so
    in-place mutations (waypoints, unit edits, drawings, participants, status)
    get persisted without touching any of app.py's ~25 mutation callsites.

Selected by an env switch in app.py: SUPABASE_URL set → this store; unset →
plain InMemorySessionStore (today's behaviour). Ships dark until creds exist.
"""

from __future__ import annotations

import json
import os
import threading
import time
from typing import Optional

from services.session_store import (
    InMemorySessionStore,
    DEFAULT_SESSION_TTL,
    DEFAULT_MAX_SESSIONS,
)

# State fields that live in the Postgres `state` jsonb (everything mutable and
# JSON-safe). The big immutable blobs go to Storage; sse_clients is ephemeral.
_STATE_FIELDS = (
    "group_waypoints",
    "unit_edits",
    "pending_triggers",
    "orig_inline_format",
    "planner_drawings",
    "participants",
)


class SupabaseSessionStore(InMemorySessionStore):
    def __init__(
        self,
        url: Optional[str] = None,
        key: Optional[str] = None,
        bucket: str = "missions",
        ttl_seconds: int = DEFAULT_SESSION_TTL,
        max_sessions: int = DEFAULT_MAX_SESSIONS,
        flush_interval: int = 10,
        client=None,
        start_loop: bool = True,
    ) -> None:
        super().__init__(ttl_seconds=ttl_seconds, max_sessions=max_sessions)
        self._bucket = bucket
        self._flush_interval = flush_interval
        # sid -> hash of last-flushed state (skip no-op writes)
        self._state_hash: dict[str, str] = {}
        # sids whose immutable blobs + row are confirmed in Supabase
        self._persisted: set[str] = set()

        if client is not None:
            self._client = client
        else:
            url = url or os.environ.get("SUPABASE_URL")
            key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            if not url or not key:
                raise RuntimeError(
                    "SupabaseSessionStore requires SUPABASE_URL and "
                    "SUPABASE_SERVICE_ROLE_KEY (or an injected client)."
                )
            from supabase import create_client  # lazy: only when activated
            self._client = create_client(url, key)

        if start_loop:
            self._start_flush_loop()

    # ------------------------------------------------------------------
    # Storage-key helpers
    # ------------------------------------------------------------------
    def _miz_key(self, sid: str) -> str:
        return f"{sid}/mission.miz"

    def _lua_key(self, sid: str) -> str:
        return f"{sid}/mission.lua"

    # ------------------------------------------------------------------
    # Overrides — lifecycle with persistence
    # ------------------------------------------------------------------
    def create(self, miz_bytes, mission_text, theater, filename, group_waypoints):
        sid, host_token = super().create(
            miz_bytes, mission_text, theater, filename, group_waypoints
        )
        try:
            self._persist_full(sid)
        except Exception as e:  # best-effort: session still works in-memory
            self._log(f"create persist failed for {sid}: {e}")
            self._persisted.discard(sid)  # flush loop will retry
        return sid, host_token

    def get(self, sid: str) -> Optional[dict]:
        s = super().get(sid)
        if s is not None:
            return s
        # Cache miss — try to bring it back from Supabase (e.g. post-restart).
        try:
            return self._hydrate(sid)
        except Exception as e:
            self._log(f"hydrate failed for {sid}: {e}")
            return None

    def delete(self, sid: str) -> bool:
        existed = super().delete(sid)
        self._state_hash.pop(sid, None)
        self._persisted.discard(sid)
        try:
            self._delete_remote(sid)
        except Exception as e:
            self._log(f"remote delete failed for {sid}: {e}")
        return existed

    def cleanup(self) -> int:
        n = super().cleanup()
        try:
            self._cleanup_remote()
        except Exception as e:
            self._log(f"remote cleanup failed: {e}")
        return n

    # ------------------------------------------------------------------
    # Persistence internals
    # ------------------------------------------------------------------
    def _serialize_state(self, session: dict) -> dict:
        state = {k: session.get(k) for k in _STATE_FIELDS}
        # set -> sorted list for JSON
        state["dirty_groups"] = sorted(session.get("dirty_groups", set()))
        return state

    def _row_for(self, sid: str, session: dict) -> dict:
        return {
            "sid": sid,
            "host_token": session["host_token"],
            "filename": session["filename"],
            "theater": session["theater"],
            "status": session.get("status", "planning"),
            "created_at": session["created_at"],
            "last_activity": session.get("last_activity", session["created_at"]),
            "miz_storage_key": self._miz_key(sid),
            "mission_text_storage_key": self._lua_key(sid),
            "state": self._serialize_state(session),
        }

    def _persist_full(self, sid: str) -> None:
        """Upload immutable blobs + upsert the full row. Run at create and as
        a retry from the flush loop if the blobs never landed."""
        with self._lock:
            session = self._sessions.get(sid)
            if session is None:
                return
            miz = session["miz_bytes"]
            lua = session["original_mission_text"]
            row = self._row_for(sid, session)

        bucket = self._client.storage.from_(self._bucket)
        bucket.upload(
            self._miz_key(sid),
            miz if isinstance(miz, (bytes, bytearray)) else bytes(miz),
            {"content-type": "application/octet-stream", "upsert": "true"},
        )
        bucket.upload(
            self._lua_key(sid),
            lua.encode("utf-8") if isinstance(lua, str) else lua,
            {"content-type": "text/plain; charset=utf-8", "upsert": "true"},
        )
        self._client.table("sessions").upsert(row).execute()
        self._persisted.add(sid)
        self._state_hash[sid] = self._hash(row["state"], row["last_activity"], row["status"])

    def _flush_state(self, sid: str) -> None:
        """Update just the mutable columns/state if they changed since last flush."""
        with self._lock:
            session = self._sessions.get(sid)
            if session is None:
                return
            state = self._serialize_state(session)
            last_activity = session.get("last_activity", session["created_at"])
            status = session.get("status", "planning")
        h = self._hash(state, last_activity, status)
        if self._state_hash.get(sid) == h:
            return  # nothing changed — skip the write
        self._client.table("sessions").update({
            "state": state,
            "last_activity": last_activity,
            "status": status,
        }).eq("sid", sid).execute()
        self._state_hash[sid] = h

    def _hydrate(self, sid: str) -> Optional[dict]:
        resp = self._client.table("sessions").select("*").eq("sid", sid).execute()
        rows = resp.data or []
        if not rows:
            return None
        r = rows[0]
        bucket = self._client.storage.from_(self._bucket)
        miz = bucket.download(r.get("miz_storage_key") or self._miz_key(sid))
        lua_raw = bucket.download(r.get("mission_text_storage_key") or self._lua_key(sid))
        lua = lua_raw.decode("utf-8") if isinstance(lua_raw, (bytes, bytearray)) else lua_raw
        state = r.get("state") or {}

        session = {
            "miz_bytes": miz,
            "original_mission_text": lua,
            "theater": r["theater"],
            "filename": r["filename"],
            "created_at": r["created_at"],
            "last_activity": r.get("last_activity", r["created_at"]),
            "group_waypoints": state.get("group_waypoints") or {},
            "dirty_groups": set(state.get("dirty_groups") or []),
            "unit_edits": state.get("unit_edits") or [],
            "pending_triggers": state.get("pending_triggers"),
            "orig_inline_format": bool(state.get("orig_inline_format", False)),
            "host_token": r["host_token"],
            "participants": state.get("participants") or {},
            "status": r.get("status") or state.get("status") or "planning",
            "sse_clients": [],  # ephemeral — rebuilt when a client reconnects
            "planner_drawings": state.get("planner_drawings") or [],
        }
        with self._lock:
            # Another thread may have hydrated/created concurrently — keep theirs.
            existing = self._sessions.get(sid)
            if existing is not None:
                return existing
            self._sessions[sid] = session
        self._persisted.add(sid)
        self._state_hash[sid] = self._hash(
            self._serialize_state(session), session["last_activity"], session["status"]
        )
        return session

    def _delete_remote(self, sid: str) -> None:
        try:
            self._client.storage.from_(self._bucket).remove([self._miz_key(sid), self._lua_key(sid)])
        except Exception as e:
            self._log(f"storage remove failed for {sid}: {e}")
        self._client.table("sessions").delete().eq("sid", sid).execute()

    def _cleanup_remote(self) -> None:
        cutoff = time.time() - self.ttl_seconds
        resp = (
            self._client.table("sessions")
            .select("sid")
            .lt("last_activity", cutoff)
            .execute()
        )
        for r in (resp.data or []):
            self._delete_remote(r["sid"])

    # ------------------------------------------------------------------
    # Background flush loop
    # ------------------------------------------------------------------
    def _start_flush_loop(self) -> None:
        t = threading.Thread(target=self._flush_loop, name="supabase-flush", daemon=True)
        t.start()

    def _flush_loop(self) -> None:
        ticks = 0
        while True:
            time.sleep(self._flush_interval)
            try:
                self.flush_all()
            except Exception as e:
                self._log(f"flush_all failed: {e}")
            ticks += 1
            # Sweep expired remote rows roughly once a minute.
            if ticks * self._flush_interval >= 60:
                ticks = 0
                try:
                    self._cleanup_remote()
                except Exception as e:
                    self._log(f"periodic remote cleanup failed: {e}")

    def flush_all(self) -> None:
        with self._lock:
            sids = list(self._sessions.keys())
        for sid in sids:
            try:
                if sid not in self._persisted:
                    self._persist_full(sid)  # retry blobs+row that never landed
                else:
                    self._flush_state(sid)
            except Exception as e:
                self._log(f"flush failed for {sid}: {e}")

    # ------------------------------------------------------------------
    # Misc
    # ------------------------------------------------------------------
    @staticmethod
    def _hash(state: dict, last_activity, status) -> str:
        return json.dumps(
            {"s": state, "la": last_activity, "st": status},
            sort_keys=True, default=str,
        )

    @staticmethod
    def _log(msg: str) -> None:
        print(f"[SupabaseSessionStore] {msg}", flush=True)
