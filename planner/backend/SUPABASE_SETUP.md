# Supabase setup — Phase 2 Step 2 prerequisite

Phase 2 of the safety-net plan replaces the in-memory `sessions` dict
with a Supabase-backed store so editor sessions survive Railway
restarts. **Step 1 (the storage abstraction refactor) is already
shipped** — see `services/session_store.py`. Step 2 is gated on the
Supabase project below being provisioned.

This document is the human side of that work. Once it's done, drop
the credentials into Railway and we can ship the SupabaseSessionStore
implementation.

---

## What you (Fett) do

### 1. Create a Supabase project

Go to <https://supabase.com> → New project. Pick a region close to
the Railway deploy region (US-East works for both). Free tier is
plenty — we're storing kilobytes of session metadata + tens of
megabytes of mission Lua per active session.

Project settings to note:
- **Project URL** (e.g. `https://abcdefgh.supabase.co`)
- **Service Role Key** (Settings → API → `service_role`, *not* `anon`)
- **JWT Secret** (Settings → API, used by Step 3 auth)

### 2. Set Railway env vars

In the Railway project for this app, add:

```
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

These are server-side only. The frontend never sees the service role
key. Don't commit these to git.

### 3. Disable public signup

Auth → Settings → "Allow new users to sign up" → **off**.
This makes the project invite-only, which is what we agreed on for
the Hornet School rollout. You'll create accounts manually in the
Supabase dashboard or via an admin script.

### 4. Set up the storage bucket

Storage → New bucket:
- Name: `missions`
- Public: **off** (private bucket)
- File size limit: 200 MB (matches the Flask `MAX_CONTENT_LENGTH`)

We'll write `.miz` bytes and parsed mission Lua to this bucket. Each
session gets its own subfolder keyed by sessionId.

### 5. (Optional) Pin a region for Postgres

Supabase auto-picks a region but if Railway is in US-East and
Supabase ends up in EU-West, every session read becomes a 100ms
trans-Atlantic trip. Worth checking before going further.

---

## What I do (next session)

When you've got the env vars in Railway and confirm signup is
disabled, I'll:

1. Add `supabase>=2.0` to `requirements.txt`.
2. Define schema migrations in `planner/backend/migrations/`:
   ```sql
   CREATE TABLE sessions (
       sid uuid PRIMARY KEY,
       host_token uuid NOT NULL,
       filename text NOT NULL,
       theater text NOT NULL,
       created_at timestamptz DEFAULT now(),
       last_activity timestamptz DEFAULT now(),
       miz_storage_key text,         -- path in storage bucket
       mission_text_storage_key text,
       state jsonb NOT NULL DEFAULT '{}'::jsonb
                                      -- group_waypoints, dirty_groups,
                                      -- unit_edits, pending_triggers,
                                      -- planner_drawings, etc.
   );
   CREATE TABLE session_participants (
       sid uuid REFERENCES sessions(sid) ON DELETE CASCADE,
       token uuid NOT NULL,
       data jsonb NOT NULL DEFAULT '{}'::jsonb,
       PRIMARY KEY (sid, token)
   );
   ```
3. Build `services/session_store_supabase.py` — same interface as
   `InMemorySessionStore`, backed by the schema above. Mission Lua /
   miz bytes go to Storage, session metadata + state go to Postgres.
4. Wire it in via an env-var switch:
   ```python
   if os.getenv("SUPABASE_URL"):
       _store = SupabaseSessionStore(...)
   else:
       _store = InMemorySessionStore()
   ```
   Local dev still uses in-memory (no creds needed); production uses
   Supabase. Tests can mock the supabase client.
5. Write integration tests that exercise both backends against a
   shared interface contract (so we keep them in sync).
6. Cut over Railway. First deploy will flush in-flight sessions — do
   it during a quiet window.

---

## What's deferred to Step 3 (auth)

Step 2 above is just persistence — no auth changes. Sessions are
still anonymous, identified by sessionId + hostToken. Step 3 adds:
- Frontend Supabase Auth login pages
- JWT verification middleware on the backend
- `user_id` column on sessions
- Per-user session listing endpoint

I'll write a separate setup doc for Step 3 once Step 2 is live.
