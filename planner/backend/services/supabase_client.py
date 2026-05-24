"""Shared Supabase client accessor for the Live/group features.

Separate from SupabaseSessionStore (which builds its own client) so the group
multi-tenancy code can use Supabase without coupling to the session store. Lazy
+ cached: returns None when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset
(so the Live features degrade gracefully, same as the session store falling
back to in-memory). Tests inject a fake via set_client()."""

from __future__ import annotations

import os

_client = None
_resolved = False


def get_supabase():
    """Return a cached Supabase client, or None if creds aren't configured."""
    global _client, _resolved
    if _client is not None:
        return _client
    if _resolved:
        return None
    _resolved = True
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    from supabase import create_client  # lazy import
    _client = create_client(url, key)
    return _client


def set_client(client) -> None:
    """Test hook: inject a fake client (and mark as resolved)."""
    global _client, _resolved
    _client = client
    _resolved = True


def reset_client() -> None:
    """Test hook: clear the cached client."""
    global _client, _resolved
    _client = None
    _resolved = False
