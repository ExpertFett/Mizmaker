-- Phase 2 Step 2 — Supabase session persistence.
--
-- Run this once in the Supabase project (SQL Editor → paste → Run) before
-- setting SUPABASE_URL on Railway. See SUPABASE_SETUP.md for the full
-- provisioning checklist (project, env vars, disable signup, storage bucket).
--
-- Design notes:
--  * created_at / last_activity are stored as epoch SECONDS (double precision)
--    to round-trip 1:1 with the in-memory store's time.time() floats — no
--    timezone parsing on hydrate. (The original draft in SUPABASE_SETUP.md
--    used timestamptz; we switched to epoch doubles for an exact match.)
--  * The big immutable blobs (.miz bytes + parsed mission Lua) live in the
--    `missions` Storage bucket, referenced by *_storage_key. Only small,
--    mutable session state goes in Postgres.
--  * Collaborative participants are folded into `state` jsonb for v1 (one
--    upsert, survives restart). The separate session_participants table from
--    the original draft is deferred to Step 3 (auth / per-user queries),
--    where querying sessions by participant actually matters.

create table if not exists sessions (
    sid                     uuid primary key,
    host_token              uuid not null,
    filename                text not null,
    theater                 text not null,
    status                  text not null default 'planning',
    created_at              double precision not null,   -- epoch seconds
    last_activity           double precision not null,   -- epoch seconds
    miz_storage_key         text,                         -- path in `missions` bucket
    mission_text_storage_key text,
    state                   jsonb not null default '{}'::jsonb
    -- state holds: group_waypoints, dirty_groups (array), unit_edits,
    -- pending_triggers, orig_inline_format, planner_drawings, participants
);

-- Cleanup scans by age; index keeps the periodic expiry sweep cheap.
create index if not exists sessions_last_activity_idx
    on sessions (last_activity);
