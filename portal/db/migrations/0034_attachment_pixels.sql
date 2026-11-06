-- ══════════════════════════════════════════════════════════════
--  0034_attachment_pixels.sql — keep the raw bytes of an image.
--
--  0030 declared `kind='image'` and said images are "passed as
--  pixels", but nothing stored the pixels: the engine returns an empty
--  string for an image and the upload route discarded the bytes. The
--  prompt builder therefore had nothing to send, and an image attached
--  to a turn reached the model as a filename and nothing else.
--
--  WHY THE BYTES AND NOT JUST A RESIZED COPY. Resizing needs an image
--  library the portal does not ship, and an upstream downscales
--  anything large anyway. `byte_size` already caps an upload at 25MB.
--  The route refuses to store bytes it cannot send (see its
--  MAX_INLINE_IMAGE_BYTES), so a NULL here always means "not an image",
--  never "an image we could not send".
--
--  WHY NOT SEPARATE TABLE. One column on a row that already exists:
--  a second table would mean a join on the hot prompt path to fetch a
--  value that is only ever read alongside the row.
--
--  TEXT ROWS STAY NULL. `extracted_text` remains the only payload for
--  every non-image kind, so this adds nothing to the size of a PDF.
--
--  FORWARD-ONLY. Recovery is `make restore`.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS content_bytes bytea;

-- The invariant the prompt builder relies on: an image row has pixels.
-- Not a CHECK, because a pre-0034 image row has none and a constraint
-- must not fail a deploy; the backfill below marks those rows so the
-- builder can tell "legacy image, no pixels" from "bug".
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS pixels_lost boolean NOT NULL DEFAULT false;

UPDATE attachments
   SET pixels_lost = true
 WHERE kind = 'image'
   AND content_bytes IS NULL
   AND pixels_lost = false;
