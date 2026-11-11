import { NextResponse } from 'next/server';

/** Spreadsheet apps evaluate a cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell. Strings that a spreadsheet would run as a formula get a leading
 * `'` (CSV injection: an email or project name like `=HYPERLINK(...)` is user
 * input), and anything with a comma, quote or line break is quoted.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A CSV download, named `<name>-<YYYY-MM-DD>.csv`. */
export function csvResponse(name: string, header: string[], rows: unknown[][]): NextResponse {
  return new NextResponse(toCsv(header, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
