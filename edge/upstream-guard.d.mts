/**
 * Types for upstream-guard.mjs.
 *
 * The edge is plain Node ESM with no build step, so it ships no types. The
 * portal's test suite imports this module directly, and `tsc --noEmit` is
 * part of the deploy gate — without this file a passing test fails the
 * typecheck with TS7016. Kept minimal on purpose: only what the guard
 * actually exports.
 */

/** The text an extracted document is replaced with. */
export declare const PDF_NOTE: string;
/** The text a URL image is replaced with. */
export declare const IMAGE_URL_NOTE: string;

export interface SanitizeResult {
  /**
   * The rewritten body. Loosely typed ON PURPOSE: the guard walks an
   * arbitrary request body and returns the same shape it was given, so the
   * honest type is "an object carrying whatever the caller passed". Tests
   * index into it (`out.messages[0]…`), which is the documented usage.
   */
  body: any;
  changed: boolean;
}

/**
 * Rewrite block types the upstream refuses (PDF documents, URL images) into
 * a text note, recursively — including inside `tool_result.content[]`,
 * which is where a replayed attachment actually lives.
 */
export declare function sanitizeUpstreamBody(node: any): SanitizeResult;

/** `sanitizeUpstreamBody`, plus the request-level fields it must not touch. */
export declare function sanitizeRequest(node: any): SanitizeResult;
