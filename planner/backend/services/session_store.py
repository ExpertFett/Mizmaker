"""
Session storage abstraction.

Step 1 of the Phase 2 (Supabase migration) plan: extract the in-memory
sessions dict + lock from app.py into a class so the storage backend
can be swapped without touching every callsite.

Today this class is a thin wrapper over a Python dict — same behavior
as the previous module-level `sessions = {}` plus `_lock` plus the
three helper functions. The point of going through a class now is so
Step 2 can add a SupabaseSessionStore that implements the same surface
without rewriting the 25+ callsites in app.py.

Interface (intentionally minimal):
    create(miz_bytes, mission_text, theater, filename, group_waypoints)
        -> (sid, host_token)
    get(sid)        -> session_dict | None
    delete(sid)     -> bool
    cleanup()       -> int   (number of expired sessions removed)
    count()         -> int
    lock            -> threading.Lock  (for code that needs to mutate
                                        session entries atomically; the
                                        Supabase backend will replace
                                        this with a per-row lock or
                                        optimistic version checking)

Mutation pattern: get() returns a live dict reference. Code that
mutates session fields (e.g. `session["dirty_groups"].add(g)`) does
so under `store.lock`. When we move to Supabase, mutations will need
an explicit `commit(sid)` call at end-of-request to flush — but that
change is intentionally deferred to Step 2 to keep this refactor
diff small.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Optional


# Session lifecycle defaults. Match the values that lived in app.py
# pre-refactor so behavior is identical post-merge.
DEFAULT_SESSION_TTL = 259200    # 72 hours — "plan over the week, fly this weekend"
                                # (sliding window on last_activity; idle sessions
                                #  expire after this. Was 2h pre-Supabase.)
DEFAULT_MAX_SESSIONS = 20


class InMemorySessionStore:
    """In-memory backend for session storage.

    Drop-in replacement for the old module-level `sessions = {}` +
    `_lock` + helper functions in app.py. All public methods are
    thread-safe.
    """

    def __init__(
        self,
        ttl_seconds: int = DEFAULT_SESSION_TTL,
        max_sessions: int = DEFAULT_MAX_SESSIONS,
    ) -> None:
        self._sessions: dict[str, dict] = {}
        self._lock = threading.Lock()
        self.ttl_seconds = ttl_seconds
        self.max_sessions = max_sessions

    # ------------------------------------------------------------------
    # Lifecycle — create / cleanup
    # ------------------------------------------------------------------

    def create(
        self,
        miz_bytes: bytes,
        mission_text: str,
        theater: str,
        filename: str,
        group_waypoints: dict,
    ) -> tuple[str, str]:
        """Create a new session and return (session_id, host_token).

        Performs an opportunistic cleanup of expired sessions and
        evicts the oldest session if we're at capacity — same policy
        the pre-refactor code used.
        """
        self.cleanup()

        # Detect inline trigger format at upload time so subsequent
        # saves always use the append path even if the in-memory
        # mission_text gets corrupted mid-session.
        orig_inline_format = False
        try:
            from services.miz_parser import parse_mission_text as _pmt
            from services.trigger_editor import extract_triggers as _et
            _md = _pmt(mission_text)
            _data = _et(_md)
            orig_inline_format = bool(_data.get("inlineFormat"))
        except Exception:
            pass

        sid = str(uuid.uuid4())
        host_token = str(uuid.uuid4())
        now = time.time()

        with self._lock:
            # Evict oldest if at capacity. (Cleanup ran above, but it
            # only removes EXPIRED entries — if every session is fresh
            # we still need to make room.)
            if len(self._sessions) >= self.max_sessions:
                oldest = min(self._sessions, key=lambda k: self._sessions[k]["created_at"])
                del self._sessions[oldest]

            self._sessions[sid] = {
                "miz_bytes": miz_bytes,
                "original_mission_text": mission_text,  # never mutated
                "theater": theater,
                "filename": filename,
                "created_at": now,
                "last_activity": now,
                # Server-authoritative waypoint state
                "group_waypoints": group_waypoints,  # { group_name: [wp, wp, ...] }
                "dirty_groups": set(),
                # Server-authoritative unit edits (loadouts, datalink, etc.)
                "unit_edits": [],
                "pending_triggers": None,
                "orig_inline_format": orig_inline_format,
                # Collaborative session fields
                "host_token": host_token,
                "participants": {},
                "status": "planning",
                "sse_clients": [],
                "planner_drawings": [],
            }
        return sid, host_token

    def cleanup(self) -> int:
        """Remove sessions whose last_activity is past the TTL.

        Returns the number of sessions removed. Caller doesn't need
        the count today — keeping it for instrumentation / testing.
        """
        now = time.time()
        with self._lock:
            expired = [
                k for k, v in self._sessions.items()
                if now - v.get("last_activity", v["created_at"]) > self.ttl_seconds
            ]
            for k in expired:
                del self._sessions[k]
        return len(expired)

    # ------------------------------------------------------------------
    # Read / write / delete
    # ------------------------------------------------------------------

    def get(self, sid: str) -> Optional[dict]:
        """Return the session dict, or None if not found.

        The returned reference is the live in-memory entry — callers
        mutate it directly (under `lock` when needed). Step 2's
        SupabaseSessionStore will return a copy and require
        commit(sid) to flush mutations.
        """
        with self._lock:
            return self._sessions.get(sid)

    def delete(self, sid: str) -> bool:
        """Remove a session. Returns True if it existed, False otherwise."""
        with self._lock:
            return self._sessions.pop(sid, None) is not None

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def count(self) -> int:
        with self._lock:
            return len(self._sessions)

    def keys(self) -> list[str]:
        """Snapshot of current session ids — for debug / SSE diagnostics."""
        with self._lock:
            return list(self._sessions.keys())

    @property
    def lock(self) -> threading.Lock:
        """Expose the underlying lock so callers that need to make a
        multi-step mutation atomic can use `with store.lock: ...`.

        This is the moral equivalent of the old module-level `_lock`.
        Step 2 will probably replace this with per-row optimistic
        locking or a sessionId-based lock map; for now it's the
        simplest swap-in.
        """
        return self._lock


# Module-level default store instance — app.py imports this directly
# and uses it as a singleton. Tests can substitute their own instance
# by reassigning app's reference.
default_store = InMemorySessionStore()
