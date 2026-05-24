-- Live "DM terminal" — multi-tenant group model (Phase A foundation).
--
-- Run in Supabase SQL Editor after 0001_sessions.sql. Backed by the same
-- project. All access goes through the Flask backend using the service_role
-- key (which bypasses RLS); membership/role checks are enforced in Flask. RLS
-- is enabled with no policies so the anon key can never touch these tables.
--
-- Model: a user logs in with Discord → creates a GROUP (becomes its admin) →
-- invites operators via a CODE → the group owns SERVER PROFILES (Olympus +
-- LotATC connection info) shared across its members.

-- One row per Discord identity that has logged in.
create table if not exists users (
    id          uuid primary key default gen_random_uuid(),
    discord_id  text not null unique,
    username    text,
    avatar      text,
    created_at  timestamptz not null default now(),
    last_login  timestamptz not null default now()
);

-- A squadron / community tenant.
create table if not exists groups (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    created_by  uuid references users(id) on delete set null,
    created_at  timestamptz not null default now()
);

-- Membership + role within a group.
create table if not exists group_members (
    group_id    uuid not null references groups(id) on delete cascade,
    user_id     uuid not null references users(id) on delete cascade,
    role        text not null default 'operator',   -- 'admin' | 'operator'
    joined_at   timestamptz not null default now(),
    primary key (group_id, user_id)
);

-- Invite codes that grant membership when redeemed.
create table if not exists group_invites (
    code        text primary key,                    -- short random token
    group_id    uuid not null references groups(id) on delete cascade,
    role        text not null default 'operator',    -- role granted on join
    created_by  uuid references users(id) on delete set null,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz,                          -- null = never expires
    max_uses    integer,                              -- null = unlimited
    uses        integer not null default 0
);

-- Server connection profiles, owned by a group, shared across its members.
-- olympus_password_enc holds the role password ENCRYPTED app-side (Fernet) —
-- it is never stored in plaintext and never returned to the browser; the
-- backend decrypts only to make the server-side relay call to Olympus.
create table if not exists server_profiles (
    id                   uuid primary key default gen_random_uuid(),
    group_id             uuid not null references groups(id) on delete cascade,
    name                 text not null,               -- e.g. "Main Server"
    olympus_host         text,
    olympus_port         integer not null default 4512,
    olympus_password_enc text,                         -- Fernet ciphertext
    lotatc_url           text,                          -- JSON export base (optional)
    created_by           uuid references users(id) on delete set null,
    updated_at           timestamptz not null default now()
);

create index if not exists group_members_user_idx    on group_members (user_id);
create index if not exists group_invites_group_idx    on group_invites (group_id);
create index if not exists server_profiles_group_idx  on server_profiles (group_id);

-- Lock down to service_role only (backend enforces membership/role).
alter table users           enable row level security;
alter table groups          enable row level security;
alter table group_members   enable row level security;
alter table group_invites   enable row level security;
alter table server_profiles enable row level security;
