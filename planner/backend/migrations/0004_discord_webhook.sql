-- v1.19.50 — Discord webhook URL per server profile.
--
-- Lets the GM mirror Live broadcasts (9-line builder, comms log) into a
-- Discord channel via a webhook URL. The URL is encrypted-at-rest with
-- the same Fernet key as the Olympus password (services/profile_crypto)
-- so a Supabase DB leak doesn't leak the webhook secret.
--
-- Apply on the production Supabase before deploying v1.19.50 — the column
-- is optional (NULL = no webhook) and existing rows are unaffected.

ALTER TABLE server_profiles
  ADD COLUMN IF NOT EXISTS discord_webhook_enc text;

COMMENT ON COLUMN server_profiles.discord_webhook_enc IS
  'Encrypted-at-rest Discord webhook URL (Fernet, PROFILE_ENC_KEY).
   Cleartext URL never returned to the client; only a hasDiscord boolean
   in the public profile shape.';
