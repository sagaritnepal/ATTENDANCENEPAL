import * as XLSX from 'xlsx';

/** A real .xlsx, not CSV — CSV-in-Excel on Windows mangled the en-dash in
 * shift labels (Excel guesses ANSI encoding without a UTF-8 BOM) and left
 * every date column showing "####" (too narrow for Excel's auto-applied
 * date format, and CSV carries no column-width metadata to fix that).
 * .xlsx has neither problem, and skips the "possible data loss" banner.
 *
 * Security note: `xlsx` (SheetJS) has open advisories, but they're all in
 * the *parsing* path (XLSX.read/readFile on an untrusted file). This module
 * only ever builds and writes a workbook from our own data — it never
 * parses one — so that code path is never reached here. */
export function downloadExcel(filename: string, headers: string[], rows: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // Size each column to its widest cell (header or data) so nothing renders
  // as Excel's "####" too-narrow-for-a-date placeholder. Capped so one long
  // outlier (e.g. a reason/note field) doesn't blow out the whole sheet.
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length));
    return { wch: Math.min(Math.max(maxLen + 2, 8), 40) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, filename.replace(/\.csv$/i, '') + '.xlsx');
}

/** Print button doubles as "Save as PDF" — every browser's print dialog
 * offers that as a destination, so no PDF-generation library is needed.
 * Pairs with the print:hidden / print:overflow-visible classes on AppShell
 * and each table's own scroll wrapper. */
export default function TableExportBar({ onExportCsv }: { onExportCsv: () => void }) {
  return (
    <div className="ml-auto flex items-center gap-2 print:hidden">
      <button
        onClick={() => window.print()}
        className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
      >
        🖨 Print / Save PDF
      </button>
      <button
        onClick={onExportCsv}
        className="flex items-center gap-1 rounded-md border border-accent bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent shadow-sm transition-colors hover:bg-accent hover:text-white"
      >
        ⭳ Export Excel
      </button>
    </div>
  );
}
