-- ════════════════════════════════════════════════════════════════════════
--  0032_device_identity.sql — record which machine a device key belongs to
--
--  Every device key was named "OpenCode Desktop", so an organization with a
--  laptop and a desktop had two identical rows and no way to tell them apart.
--  Since approval revokes every previous device key for the organization, the
--  person being signed out on the other machine had no way to see which
--  machine that was — and the dashboard could not show it either.
--
--  The desktop now reports a human-readable name (hostname plus platform) when
--  it starts a device-code flow. It is display metadata only: never secret,
--  never used for authorization, and safe to show in a key list.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE device_codes
  ADD COLUMN IF NOT EXISTS device_name TEXT;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS device_name TEXT;
