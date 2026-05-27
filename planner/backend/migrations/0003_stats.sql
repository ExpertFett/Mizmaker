-- App-wide vanity counters (homepage "missions edited", etc.).
-- One row per counter key. Run this once in the Supabase SQL editor.
create table if not exists app_stats (
    key        text primary key,
    value      bigint not null default 0,
    updated_at timestamptz not null default now()
);

-- Seed the missions-edited counter at 0 (only if it doesn't exist yet).
insert into app_stats (key, value) values ('missions_edited', 0)
    on conflict (key) do nothing;
