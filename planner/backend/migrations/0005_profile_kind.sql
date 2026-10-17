-- Server profile backend kind: 'olympus' (DCS Olympus, :4512 binary feed) or
-- 'olympuslite' (the single-file OlympusLite JSON hook, :4513).
--
-- Run in the Supabase SQL Editor after 0004_discord_webhook.sql. Optional at
-- ship time: services/groups.py only writes the column for non-default kinds,
-- and reads a missing column as 'olympus', so existing Olympus profiles keep
-- working before this runs. An OlympusLite profile can't be saved until it does.

alter table server_profiles
    add column if not exists kind text not null default 'olympus';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'server_profiles_kind_check'
    ) then
        alter table server_profiles
            add constraint server_profiles_kind_check
            check (kind in ('olympus', 'olympuslite'));
    end if;
end $$;
