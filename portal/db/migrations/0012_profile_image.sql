-- ═══════════════════════════════════════════════════════════════════════
--  0012_profile_image.sql — a picture for `users`
--
--  Adds `users.image`: the account's profile picture, stored as a data URL
--  (`data:image/png;base64,…`). Self-contained by design — no object store,
--  no third-party fetch (Gravatar would leak every dashboard view to an
--  outside host), no local-disk file that a `docker compose up --build`
--  wipes. The price is a size discipline enforced in
--  lib/account/service.ts (PNG/JPEG/WebP magic bytes, 256 KiB decoded
--  cap), not in this file: a CHECK constraint cannot decode base64.
--
--  NULL means "no picture" and the UI falls back to name initials, so
--  every existing row is already valid and no backfill is needed.
--
--  FORWARD-ONLY, like every migration here. Recovery is `make restore`.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN image TEXT;

COMMENT ON COLUMN users.image IS
  'Profile picture as a data URL (data:image/{png,jpeg,webp};base64,…), max 256 KiB decoded. NULL = initials fallback. Validated in lib/account/service.ts.';
