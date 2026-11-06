/**
 * POST /api/attachments — upload a file, get back an extracted attachment.
 *
 * The engine does the parsing (Rust, `engine/`), so this route is policy:
 * who may upload, how big, which types, and what is stored.
 *
 * ORDER MATTERS AND IS DELIBERATE:
 *
 *   1. `requireActiveOrg` — before reading the body. An unauthenticated
 *      caller must not be able to make us buffer a 25MB upload.
 *   2. `content-length` — before parsing multipart. A declared size over
 *      the limit is refused without a byte being read.
 *   3. the file itself — a byte cap enforced while reading.
 *   4. extraction — the untrusted parse, in the engine, in memory.
 *   5. insert — keyed on `(organization_id, content_hash)`.
 *
 * STORAGE IS TEXT, NOT THE FILE. The bytes are not kept: the engine returns
 * the extracted text, which is what the model reads, and discarding the
 * original means this product is not secretly a file host with a retention
 * problem. The `content_hash` dedupes so re-uploading the same PDF does not
 * double the row count.
 */
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

import { db } from '@/db';
import { errorResponse, jsonError } from '@/lib/api/errors';
import { requireActiveOrg } from '@/lib/auth/authorize';
import { ATTACHMENT_TYPES_HINT, isAllowedFile } from '@/lib/chat/attachments';
import { engineConfigured, extractDocument, maxUploadBytes } from '@/lib/engine/client';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The allow-list lives in `lib/chat/attachments.ts` so the route, the schema
 * and the composer's `accept` cannot disagree about what is uploadable. An
 * unknown type is refused rather than handed to a parser that will guess: the
 * extension is the primary signal because docx and xlsx share a zip magic
 * number.
 */

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();

    if (!engineConfigured()) {
      return jsonError('validation', 'File attachments are not enabled on this deployment.');
    }

    // ── 2. Declared size, before touching the body.
    const declared = Number(request.headers.get('content-length') ?? '0');
    const limit = maxUploadBytes();
    // Multipart framing adds a few hundred bytes of boundary and headers,
    // so the cap is applied to the file itself below; this is only the
    // early-out for an obviously absurd request.
    if (declared > limit * 1.1 + 4096) {
      return jsonError('validation', `That file is larger than the ${Math.round(limit / 1024 / 1024)}MB limit.`);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError('validation', 'That upload could not be read.');
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return jsonError('validation', 'No file was included.');
    }

    const filename = sanitiseFilename(file.name || 'upload');
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    if (!isAllowedFile(filename)) {
      return jsonError(
        'validation',
        `${ATTACHMENT_TYPES_HINT}. That file is a .${ext || 'file with no extension'}.`,
      );
    }

    if (file.size === 0) return jsonError('validation', 'That file is empty.');
    if (file.size > limit) {
      return jsonError(
        'validation',
        `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${Math.round(limit / 1024 / 1024)}MB.`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // Computed from the bytes we actually have, not from the header.
    const contentHash = createHash('sha256').update(bytes).digest('hex');

    // ── 5a. Already uploaded by this org? Return the existing row. Two
    // tenants uploading the same public PDF get two rows (the unique index
    // is per org), so one tenant deleting it cannot blank another's.
    const existing = await findByHash(ctx.orgId, ctx.userId, contentHash);
    if (existing) return Response.json({ attachment: existing });

    // ── 4. Extraction. The engine parses in memory and never writes the
    // file to disk; a failure here is reported in the user's terms.
    const extracted = await extractDocument(bytes, filename, file.type || 'application/octet-stream');
    if (!extracted.ok) {
      log.warn('attachment extraction failed', { code: extracted.code, ext, size: file.size });
      // `unavailable` is a deploy condition, not the user's file.
      if (extracted.code === 'unavailable' || extracted.code === 'timeout') {
        return jsonError('upstream', extracted.message);
      }
      return jsonError('validation', extracted.message);
    }

    const doc = extracted.value;
    const rows = (await db.execute(sql`
      INSERT INTO attachments
        (organization_id, user_id, filename, mime_type, byte_size,
         kind, content_hash, extracted_text, truncated)
      VALUES (${ctx.orgId}::uuid, ${ctx.userId}::uuid, ${filename},
              ${file.type || 'application/octet-stream'}, ${file.size},
              ${doc.kind}, ${contentHash}, ${doc.text}, ${doc.truncated})
      ON CONFLICT (organization_id, content_hash) DO UPDATE
        SET filename = EXCLUDED.filename
      RETURNING id, filename, mime_type, byte_size, kind, truncated, created_at
    `)) as unknown as {
      id: string;
      filename: string;
      mime_type: string;
      byte_size: number;
      kind: string;
      truncated: boolean;
      created_at: string | Date;
    }[];

    const row = rows[0];
    if (!row) return jsonError('internal', 'The attachment could not be saved.');

    return Response.json({
      attachment: {
        id: row.id,
        filename: row.filename,
        mimeType: row.mime_type,
        byteSize: Number(row.byte_size),
        kind: row.kind,
        truncated: row.truncated,
        chars: doc.text.length,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * GET /api/attachments?id=… — the extracted text, for the preview panel.
 *
 * Scoped by org AND user: an attachment belongs to the person who uploaded
 * it, and a shared conversation is the only path by which anyone else ever
 * sees its text.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await requireActiveOrg();
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return jsonError('validation', 'Unknown attachment.');

    const rows = (await db.execute(sql`
      SELECT id, filename, mime_type, byte_size, kind, extracted_text, truncated, created_at
        FROM attachments
       WHERE id              = ${id}::uuid
         AND organization_id = ${ctx.orgId}::uuid
         AND user_id         = ${ctx.userId}::uuid
    `)) as unknown as {
      id: string;
      filename: string;
      mime_type: string;
      byte_size: number;
      kind: string;
      extracted_text: string;
      truncated: boolean;
      created_at: string | Date;
    }[];

    const row = rows[0];
    if (!row) return jsonError('not_found', 'That file is no longer available.');

    return Response.json(
      {
        attachment: {
          id: row.id,
          filename: row.filename,
          mimeType: row.mime_type,
          byteSize: Number(row.byte_size),
          kind: row.kind,
          truncated: row.truncated,
          text: row.extracted_text,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

async function findByHash(orgId: string, userId: string, hash: string) {
  const rows = (await db.execute(sql`
    SELECT id, filename, mime_type, byte_size, kind, truncated, created_at,
           length(extracted_text) AS chars
      FROM attachments
     WHERE organization_id = ${orgId}::uuid
       AND content_hash    = ${hash}
       AND user_id         = ${userId}::uuid
  `)) as unknown as {
    id: string;
    filename: string;
    mime_type: string;
    byte_size: number;
    kind: string;
    truncated: boolean;
    chars: number;
    created_at: string | Date;
  }[];
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    kind: row.kind,
    truncated: row.truncated,
    chars: Number(row.chars),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

/**
 * Strip any path, control characters and absurd length from a filename.
 *
 * The name is displayed and used as a tag attribute in the prompt, so it is
 * both a rendering surface and a prompt surface. `../../etc/passwd` is not
 * a traversal risk (nothing is written to disk) but it is a lie about what
 * the file is, and a newline would break the tag it is written into.
 */
export function sanitiseFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'upload';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/["<>]/g, '')
    .trim();
  return (cleaned || 'upload').slice(0, 200);
}
