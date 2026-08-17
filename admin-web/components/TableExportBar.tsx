/** CSV is what "Export Excel" produces here — Excel opens it natively, and
 * it needs no extra dependency the way a real .xlsx writer would. */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
