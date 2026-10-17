-- ════════════════════════════════════════════════════════════════════════
--  0013_device_codes.sql — device-code authorization flow (Zaino Desktop sign-in)
--
--  Holds pending device-code authorizations until the desktop app polls for
--  its token. One row per issuance; each expires 15 minutes after creation
--  whether or not it was ever approved, so an abandoned code cannot be used
--  later. The flow:
--
--    1. Desktop app POSTs /api/auth/device → gets device_code + user_code +
--       verification_url. The device code (raw) is returned once; only its
--       SHA-256 is stored.
--    2. The app opens verification_url in the system browser. The portal
--       page /device shows user_code and an approve button; approval requires
--       an Auth.js session (POST /api/auth/device/verify).
--    3. On approval the portal mints a device-scoped gateway key (zn-…,
--       ~30-day lifetime) for the user's organization and stores its one-time
--       plaintext in key_plaintext.
--    4. The app polls POST /api/auth/device/token with the device code until
--       it receives { token, models, user, organization } (or a pending/
--       expired error), then stores the key in the OS keychain via the
--       desktop's existing key custody. key_plaintext is nulled on
--       consumption and never logged.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS device_codes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code_hash TEXT NOT NULL UNIQUE,
  user_code      TEXT NOT NULL UNIQUE,
  user_id        UUID REFERENCES users(id),
  organization_id UUID REFERENCES organizations(id),
  status         TEXT NOT NULL DEFAULT 'pending',
                -- pending | approved | consumed | expired | revoked
  interval_seconds INTEGER NOT NULL DEFAULT 5,
  expires_at     TIMESTAMP WITH TIME ZONE NOT NULL,
  approved_at    TIMESTAMP WITH TIME ZONE,
  consumed_at    TIMESTAMP WITH TIME ZONE,
  key_id         UUID REFERENCES api_keys(id),
  key_plaintext  TEXT,  -- one-time zn- key plaintext; held between approval and the app's first successful poll; NULL after consumption
  models         TEXT[] NOT NULL DEFAULT '{}', -- entitled alias set the minted key carries
  last_polled_at TIMESTAMP WITH TIME ZONE, -- last token-poll time; enforces the server interval
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_codes_status_idx ON device_codes(status);
CREATE INDEX IF NOT EXISTS device_codes_expires_at_idx ON device_codes(expires_at);

COMMENT ON TABLE device_codes IS
  'Pending device-code authorizations for Zaino Desktop sign-in. Rows expire 15 minutes after creation.';

COMMENT ON COLUMN device_codes.key_plaintext IS
  'One-time plaintext of the minted zn- key, held between approval and the app''s first successful poll. NULL after consumption. Never logged.';

-- A device key is a separate credential class from personal dashboard keys:
-- one per organization, minted by the device flow, revoked before its
-- replacement is minted so a device never holds two valid keys at once.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'personal';
-- personal | device

COMMENT ON COLUMN api_keys.kind IS
  'Credential class: personal (minted in the dashboard) or device (minted by the Zaino Desktop device-code flow).';