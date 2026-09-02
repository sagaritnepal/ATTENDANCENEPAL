'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Avatar from '@/components/Avatar';
import DatePicker from '@/components/DatePicker';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import { formatAdDate, monthDateRange } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso } from '@/lib/shift';
import { fetchMyCompanyWeekOffConfig } from '@/lib/weekOff';
import type { Employee } from '@/lib/types';

/** The one place a company's salary structure is set: the three contribution
 * rates (companies.pf_rate/ssf_rate/tds_rate — one company-wide percentage of
 * Basic each), plus per-employee Basic and Allowance, editable inline in the
 * table. The monthly Payroll report only reads these figures.
 *
 * A date selector switches every figure between the full monthly amount and
 * the per-day amount (monthly ÷ the number of days in the calendar month the
 * picked date falls in). Each row expands to a full per-employee breakdown,
 * and the whole page — every row's breakdown included — prints. */
export default function SalaryStructurePage() {
  const { system } = useCalendarSystem();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Saved rates (what's in the DB) vs the draft strings the header inputs
  // edit. The table previews with the draft so editing recalculates live;
  // "Save rates" persists and clears the dirty state.
  const [savedRates, setSavedRates] = useState({ pf: 10, ssf: 11, tds: 0 });
  const [pfDraft, setPfDraft] = useState('10');
  const [ssfDraft, setSsfDraft] = useState('11');
  const [tdsDraft, setTdsDraft] = useState('0');
  const [saving, setSaving] = useState(false);

  // Inline per-employee Basic / Allowance editing — one cell at a time, same
  // edit-in-place pattern the Payroll page uses for salary.
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'salary' | 'allowance' } | null>(null);
  const [cellDraft, setCellDraft] = useState('');
  const [savingCell, setSavingCell] = useState(false);

  // Monthly (default) vs per-day view. `asOfDate` is an AD YYYY-MM-DD key;
  // per-day figures divide the monthly amount by the number of days in the
  // calendar month (in whichever system is active) that date falls in.
  const [viewMode, setViewMode] = useState<'monthly' | 'perDay'>('monthly');
  const [asOfDate, setAsOfDate] = useState<string>(() => nepalTodayIso());

  // Per-employee breakdown rows the reader has opened on screen. The print
  // layout always carries every row's full breakdown (a print-only block
  // inside each Employee cell) regardless of what's expanded here.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
      setIsAdmin(profile?.role === 'admin');
    });

    fetchMyCompanyWeekOffConfig().then(({ companyId, pfRate, ssfRate, tdsRate }) => {
      setCompanyId(companyId);
      setSavedRates({ pf: pfRate, ssf: ssfRate, tds: tdsRate });
      setPfDraft(String(pfRate));
      setSsfDraft(String(ssfRate));
      setTdsDraft(String(tdsRate));
    });

    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .then(({ data }) => {
        setEmployees((data ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
        setLoading(false);
      });
  }, []);

  const pf = Number(pfDraft) || 0;
  const ssf = Number(ssfDraft) || 0;
  const tds = Number(tdsDraft) || 0;

  const dirty =
    pfDraft !== String(savedRates.pf) || ssfDraft !== String(savedRates.ssf) || tdsDraft !== String(savedRates.tds);

  // Number of days in the calendar month `asOfDate` falls in, in the active
  // AD/BS system — the divisor for every per-day figure.
  const daysInMonth = useMemo(() => {
    const [y, m, d] = asOfDate.split('-').map(Number);
    if (!y || !m || !d) return 30;
    const { start, end } = monthDateRange(system, { year: y, month: m - 1, day: d });
    return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  }, [asOfDate, system]);

  const perDay = viewMode === 'perDay';
  const factor = perDay ? 1 / daysInMonth : 1;

  /** Monthly figure -> the number shown, scaled to the active view. */
  function shown(n: number | null | undefined): string {
    if (n == null) return '—';
    return (n * factor).toLocaleString(undefined, { maximumFractionDigits: perDay ? 2 : 0 });
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return employees
      .filter(e =>
        !term
          ? true
          : [e.name, e.designation, e.employee_code].filter(Boolean).some(v => (v as string).toLowerCase().includes(term))
      )
      .map(e => {
        const basic = e.salary;
        const allowance = e.allowance ?? 0;
        if (basic == null) {
          return { e, basic: null as number | null, allowance, gross: null, pfAmt: null, ssfAmt: null, tdsAmt: null, net: null };
        }
        const pfAmt = Math.round((basic * pf) / 100);
        const ssfAmt = Math.round((basic * ssf) / 100);
        const tdsAmt = Math.round((basic * tds) / 100);
        const gross = basic + allowance;
        return { e, basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, net: gross - pfAmt - ssfAmt - tdsAmt };
      });
  }, [employees, search, pf, ssf, tds]);

  const totals = useMemo(() => {
    let basic = 0,
      allowance = 0,
      gross = 0,
      pfAmt = 0,
      ssfAmt = 0,
      tdsAmt = 0,
      net = 0,
      counted = 0;
    for (const r of rows) {
      if (r.basic == null) continue;
      counted++;
      basic += r.basic;
      allowance += r.allowance;
      gross += r.gross!;
      pfAmt += r.pfAmt!;
      ssfAmt += r.ssfAmt!;
      tdsAmt += r.tdsAmt!;
      net += r.net!;
    }
    return { basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, net, counted, deductions: pfAmt + ssfAmt + tdsAmt };
  }, [rows]);

  const allExpanded = rows.length > 0 && rows.every(r => expandedIds.has(r.e.id));

  function toggleRow(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setExpandedIds(allExpanded ? new Set() : new Set(rows.map(r => r.e.id)));
  }

  async function saveRates() {
    if (!companyId) return;
    setSaving(true);
    const { error } = await supabase
      .from('companies')
      .update({ pf_rate: pf, ssf_rate: ssf, tds_rate: tds })
      .eq('id', companyId);
    setSaving(false);
    if (error) {
      alert(`Could not save the rates: ${error.message}`);
      return;
    }
    setSavedRates({ pf, ssf, tds });
  }

  function cancelRates() {
    setPfDraft(String(savedRates.pf));
    setSsfDraft(String(savedRates.ssf));
    setTdsDraft(String(savedRates.tds));
  }

  function startEditCell(id: string, field: 'salary' | 'allowance', current: number | null) {
    setEditingCell({ id, field });
    setCellDraft(current != null ? String(current) : '');
  }

  function cancelEditCell() {
    setEditingCell(null);
    setCellDraft('');
  }

  async function saveCell() {
    if (!editingCell) return;
    const { id, field } = editingCell;
    const trimmed = cellDraft.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value != null && (Number.isNaN(value) || value < 0)) {
      alert('Enter a valid amount (0 or more), or clear it to unset.');
      return;
    }
    setSavingCell(true);
    const { error } = await supabase.from('employees').update({ [field]: value }).eq('id', id);
    setSavingCell(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setEmployees(prev => prev.map(e => (e.id === id ? { ...e, [field]: value } : e)));
    cancelEditCell();
  }

  // Plain function returning a <td>, not a nested component — see rateHeader.
  // In per-day view the figure is read-only (you edit the monthly amount in
  // the monthly view) so the value shown is always scaled by `shown()`.
  const amountCell = (id: string, field: 'salary' | 'allowance', value: number | null) => {
    if (!perDay && editingCell?.id === id && editingCell.field === field) {
      return (
        <td className="whitespace-nowrap px-3 py-2 text-right align-top">
          <input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            value={cellDraft}
            onChange={e => setCellDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveCell();
              if (e.key === 'Escape') cancelEditCell();
            }}
            className="w-24 rounded-md border border-slate-200 px-2 py-1 text-right text-xs tabular-nums text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button onClick={cancelEditCell} disabled={savingCell} className="text-[11px] font-medium text-slate-500 hover:underline disabled:opacity-60">
              Cancel
            </button>
            <button onClick={saveCell} disabled={savingCell} className="text-[11px] font-semibold text-accent hover:underline disabled:opacity-60">
              {savingCell ? 'Saving…' : 'Save'}
            </button>
          </div>
        </td>
      );
    }
    return (
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className={value == null ? 'text-slate-300' : undefined}>{shown(value)}</span>
          {!perDay && (
            <button
              onClick={() => startEditCell(id, field, value)}
              title={field === 'salary' ? 'Edit basic salary' : 'Edit allowance'}
              className="text-slate-300 hover:text-accent print:hidden"
            >
              <EditIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </td>
    );
  };

  function exportCsv() {
    const suffix = perDay ? ' /day' : '';
    const header = ['Employee', 'Designation', `Basic${suffix}`, `Allowance${suffix}`, `Gross${suffix}`, `PF (${pf}%)${suffix}`, `SSF (${ssf}%)${suffix}`, `TDS (${tds}%)${suffix}`, `Net Payable${suffix}`];
    const cell = (n: number | null) => (n == null ? '' : Number((n * factor).toFixed(perDay ? 2 : 0)));
    const lines = rows.map(r => [
      r.e.name,
      r.e.designation ?? '',
      cell(r.basic),
      r.allowance ? cell(r.allowance) : '',
      cell(r.gross),
      cell(r.pfAmt),
      cell(r.ssfAmt),
      cell(r.tdsAmt),
      cell(r.net),
    ]);
    downloadExcel(perDay ? `salary_structure_per_day_${asOfDate}.csv` : 'salary_structure.csv', header, lines);
  }

  // Plain function returning JSX, not a nested component — a `<RateHeader/>`
  // component type would get a fresh identity each render and remount its
  // input, dropping focus mid-type.
  const rateHeader = (label: string, value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col items-end gap-1">
      <span>{label}</span>
      <span className="flex items-center gap-1 normal-case tracking-normal print:hidden">
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          disabled={!isAdmin}
          onChange={e => onChange(e.target.value)}
          className="w-14 rounded-md border border-slate-200 px-1.5 py-1 text-right text-xs font-bold text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <span className="text-[10px] font-medium text-slate-400">% of basic</span>
      </span>
      <span className="hidden text-[10px] font-medium normal-case tracking-normal text-slate-400 print:block">{value}% of basic</span>
    </div>
  );

  const dateLabel = formatAdDate(asOfDate, system);
  const modeLine = perDay
    ? `Per-day amounts for ${dateLabel} — that month has ${daysInMonth} days`
    : 'Full monthly amounts';

  return (
    <AppShell title="Salary Structure">
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3 print:hidden">
        <div className="rounded-xl bg-info-bg p-3 shadow-sm ring-1 ring-inset ring-info/10">
          <span className="text-xs font-medium text-info-text/80">Total Gross Payroll{perDay && ' / day'}</span>
          <div className="mt-1 text-base font-bold text-info-text">{shown(totals.gross)}</div>
          <div className="mt-0.5 text-[11px] text-info-text/70">Basic {shown(totals.basic)} · Allowance {shown(totals.allowance)}</div>
        </div>
        <div className="rounded-xl bg-critical-bg p-3 shadow-sm ring-1 ring-inset ring-critical/10">
          <span className="text-xs font-medium text-critical-text/80">Total Deductions{perDay && ' / day'}</span>
          <div className="mt-1 text-base font-bold text-critical-text">{shown(totals.deductions)}</div>
          <div className="mt-0.5 text-[11px] text-critical-text/70">
            PF {shown(totals.pfAmt)} · SSF {shown(totals.ssfAmt)} · TDS {shown(totals.tdsAmt)}
          </div>
        </div>
        <div className="rounded-xl bg-good-bg p-3 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Total Net Payable{perDay && ' / day'}</span>
          <div className="mt-1 text-base font-bold text-good-text">{shown(totals.net)}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">Across {totals.counted} staff on a salary</div>
        </div>
      </div>

      {dirty && isAdmin && (
        <div className="mb-3 flex items-center justify-between rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 print:hidden">
          <span className="text-sm font-medium text-ink">Unsaved contribution-rate changes</span>
          <div className="flex gap-2">
            <button
              onClick={cancelRates}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={saveRates}
              disabled={saving}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save rates'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-4 sm:px-6 print:hidden">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <StructureIcon className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-bold text-ink">Monthly Salary Structure</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold shadow-sm">
              <button
                onClick={() => setViewMode('monthly')}
                className={`px-3 py-2 ${viewMode === 'monthly' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setViewMode('perDay')}
                className={`px-3 py-2 ${viewMode === 'perDay' ? 'bg-accent text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Per day
              </button>
            </div>
            <DatePicker value={asOfDate} onChange={d => { setAsOfDate(d); setViewMode('perDay'); }} className="w-44" />
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search staff…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-48 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-ink shadow-sm placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </div>
            <button
              onClick={toggleAll}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
            >
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
            <TableExportBar onExportCsv={exportCsv} />
          </div>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500 sm:px-6 print:hidden">
          {modeLine}
          {!isAdmin && <> · the PF / SSF / TDS rates are read-only for your role — an admin sets them here.</>}
        </div>

        <div className="hidden px-4 pt-4 sm:px-6 print:block">
          <h1 className="text-lg font-bold text-ink">Monthly Salary Structure</h1>
          <p className="text-xs text-slate-500">
            {modeLine} · PF {pf}% · SSF {ssf}% · TDS {tds}% of Basic
          </p>
        </div>

        <div className="max-h-[65vh] overflow-auto print:max-h-none print:overflow-visible">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-y border-slate-200 bg-slate-50 align-bottom text-xs uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap px-3 py-2 font-medium">Employee</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Designation</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Basic</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Allowance</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Gross</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('PF', pfDraft, setPfDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('SSF', ssfDraft, setSsfDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium text-critical-text">
                  {rateHeader('TDS', tdsDraft, setTdsDraft)}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Net Payable</th>
              </tr>
            </thead>
            <tbody>
              {/* Each employee: a summary row, then a breakdown row directly
                  under it — shown on screen only when expanded, but always
                  emitted so a printout carries every employee's full detail
                  (print:table-row overrides `hidden`). */}
              {rows.map(row => {
                const { e, basic, allowance, gross, pfAmt, ssfAmt, tdsAmt, net } = row;
                const open = expandedIds.has(e.id);
                return (
                  <Fragment key={e.id}>
                    <tr className="border-b border-slate-100 align-top hover:bg-slate-50 print:break-inside-avoid">
                      <td className="px-3 py-2 font-medium text-ink">
                        <span className="flex items-center gap-2">
                          <button
                            onClick={() => toggleRow(e.id)}
                            title={open ? 'Hide breakdown' : 'Show breakdown'}
                            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-accent print:hidden"
                          >
                            <ChevronIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
                          </button>
                          <Avatar name={e.name} photoUrl={e.profile_photo_url} />
                          <span>
                            {e.name}
                            {e.employee_code && <span className="ml-1 text-xs font-normal text-slate-400">#{e.employee_code}</span>}
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{e.designation || '—'}</td>
                      {amountCell(e.id, 'salary', basic)}
                      {amountCell(e.id, 'allowance', allowance)}
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-ink">{shown(gross)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(pfAmt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(ssfAmt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-critical-text">{shown(tdsAmt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-good-text">{shown(net)}</td>
                    </tr>
                    <tr className={`border-b border-slate-100 bg-slate-50/60 print:table-row print:break-inside-avoid ${open ? '' : 'hidden'}`}>
                      <td colSpan={9} className="px-3 py-3 sm:px-6">
                        <EmployeeBreakdown
                          row={row}
                          pf={pf}
                          ssf={ssf}
                          tds={tds}
                          daysInMonth={daysInMonth}
                          dateLabel={dateLabel}
                          system={system}
                        />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    {loading ? 'Loading…' : 'No active employees.'}
                  </td>
                </tr>
              )}
            </tbody>
            {totals.counted > 0 && (
              <tfoot>
                <tr className="sticky bottom-0 border-t-2 border-slate-200 bg-slate-50 text-sm font-bold text-ink">
                  <td colSpan={2} className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total{perDay && ' / day'} · {totals.counted} staff
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.basic)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.allowance)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.gross)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.pfAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.ssfAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{shown(totals.tdsAmt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-good-text">{shown(totals.net)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Net Payable = Basic + Allowance − PF − SSF − TDS. Click a Basic or Allowance figure to edit it for that employee; the
        PF / SSF / TDS rates are company-wide. Per-day figures divide the monthly amount by the number of days in the picked
        date&apos;s calendar month. The monthly Payroll report reads these figures and is not edited there. Overtime, where
        earned, is added on top on the Payroll report.
      </p>
    </AppShell>
  );
}

/** Full per-employee breakdown — monthly vs per-day columns side by side,
 * plus the employee's payroll-relevant identifiers. Shared by the on-screen
 * expanded row and the print-only block inside the employee cell. */
function EmployeeBreakdown({
  row,
  pf,
  ssf,
  tds,
  daysInMonth,
  dateLabel,
  system,
}: {
  row: {
    e: Employee;
    basic: number | null;
    allowance: number;
    gross: number | null;
    pfAmt: number | null;
    ssfAmt: number | null;
    tdsAmt: number | null;
    net: number | null;
  };
  pf: number;
  ssf: number;
  tds: number;
  daysInMonth: number;
  dateLabel: string;
  system: 'AD' | 'BS';
}) {
  const { e } = row;
  const meta: [string, string][] = [
    ['Employee code', e.employee_code || '—'],
    ['Enroll ID', e.fingerprint_id || '—'],
    ['Designation', e.designation || '—'],
    ['Department', e.department || '—'],
    ['Date of joining', e.date_of_joining ? formatAdDate(e.date_of_joining, system) : '—'],
    ['PAN no', e.pan_no || '—'],
    ['SSF no', e.ssf_no || '—'],
  ];

  const money = (n: number | null, divide: boolean) => {
    if (n == null) return '—';
    const v = divide ? n / daysInMonth : n;
    return v.toLocaleString(undefined, { maximumFractionDigits: divide ? 2 : 0 });
  };

  const lines: { label: string; value: number | null; sign?: '+' | '−'; strong?: boolean }[] = [
    { label: 'Basic', value: row.basic },
    { label: 'Allowance', value: row.allowance, sign: '+' },
    { label: 'Gross Pay', value: row.gross, strong: true },
    { label: `PF (${pf}% of basic)`, value: row.pfAmt, sign: '−' },
    { label: `SSF (${ssf}% of basic)`, value: row.ssfAmt, sign: '−' },
    { label: `TDS (${tds}% of basic)`, value: row.tdsAmt, sign: '−' },
    { label: 'Net Payable', value: row.net, strong: true },
  ];

  return (
    <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-3 text-xs sm:grid-cols-2 print:border-slate-300">
      <div>
        <div className="mb-1.5 font-semibold uppercase tracking-wide text-slate-400">Employee details</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {meta.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-400">{k}</dt>
              <dd className="text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <div className="mb-1.5 font-semibold uppercase tracking-wide text-slate-400">Salary breakdown</div>
        <table className="w-full tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-slate-400">
              <th className="py-1 text-left font-medium">Component</th>
              <th className="py-1 text-right font-medium">Per month</th>
              <th className="py-1 text-right font-medium">Per day ({dateLabel})</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.label} className={l.strong ? 'border-t border-slate-200 font-semibold text-ink' : 'text-slate-600'}>
                <td className="py-1 text-left">
                  {l.sign && <span className="mr-0.5 text-slate-400">{l.sign}</span>}
                  {l.label}
                </td>
                <td className="py-1 text-right">{money(l.value, false)}</td>
                <td className="py-1 text-right">{money(l.value, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[10px] text-slate-400">Per-day = per-month ÷ {daysInMonth} days</p>
      </div>
    </div>
  );
}

function StructureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h18M9 9v11" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
