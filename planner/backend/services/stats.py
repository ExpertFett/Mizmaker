"""App-wide vanity counters (e.g. "missions edited") for the homepage.

Persistent across restarts/deploys when Supabase is configured (uses the shared
get_supabase() client + an `app_stats` table — run migrations/0003_stats.sql).
Falls back to an in-memory counter when Supabase is unset (local dev), so the
feature works everywhere; it just doesn't persist locally.

Best-effort by design: a stats hiccup must NEVER break a real mission download,
so every public function swallows its own errors.
"""

from __future__ import annotations

import threading

from services.supabase_client import get_supabase

_TABLE = "app_stats"
MISSIONS_EDITED = "missions_edited"

_lock = threading.Lock()
_mem: dict[str, int] = {}


def _read_supabase(sb, key: str) -> int:
    rows = sb.table(_TABLE).select("value").eq("key", key).execute().data or []
    return int(rows[0].get("value") or 0) if rows else 0


def bump_missions_edited() -> None:
    """Increment the missions-edited counter by 1. Never raises."""
    try:
        sb = get_supabase()
        if sb is not None:
            # Read-modify-write upsert. The race window (two downloads in the
            # same instant) can drop a count — negligible for a vanity metric.
            current = _read_supabase(sb, MISSIONS_EDITED)
            sb.table(_TABLE).upsert({"key": MISSIONS_EDITED, "value": current + 1}).execute()
            return
    except Exception:
        pass
    with _lock:
        _mem[MISSIONS_EDITED] = _mem.get(MISSIONS_EDITED, 0) + 1


def get_missions_edited() -> int:
    """Current missions-edited total. Never raises (returns 0 on failure)."""
    try:
        sb = get_supabase()
        if sb is not None:
            return _read_supabase(sb, MISSIONS_EDITED)
    except Exception:
        pass
    with _lock:
        return _mem.get(MISSIONS_EDITED, 0)
