'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import { buildPeriodOptions, currentSystemYearMonth, formatDdMmYyyy, systemPeriod, type CalendarPeriod } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Branch, Employee } from '@/lib/types';

// Nepal SSF: employer contributes 20% of basic, employee 11% of basic. These
// are statutory and fixed, so they live here rather than as company config.
const SSF_EMPLOYER_RATE = 0.2;
const SSF_EMPLOYEE_RATE = 0.11;

function money(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type SheetRow = {
  id: string;
  name: string;
  designation: string;
  basic: number;
  dearness: number;
  ssfBasis: number; // 20% of basic — the "SSF (20% of basic)" build-up column
  mgs: number; // basic + dearness + employer SSF
  ssfEmployer: number;
  ssfEmployee: number;
  totalSsf: number;
  net: number; // mgs - totalSsf
};

/**
 * The "Staff Salary Sheet" — a fixed-salary payroll report for one customer
 * (companies.payroll_format = 'staff_salary_sheet'). Everyone is paid full
 * basic + a flat dearness allowance every month; there is NO attendance,
 * proration, overtime, PF or TDS. Rendered by app/payroll/page.tsx in place
 * of the standard attendance-based report.
 */
export default function StaffSalarySheet({ dearnessAllowance }: { dearnessAllowance: number }) {
  const { system } = useCalendarSystem();
  const [period, setPeriod] = useState<CalendarPeriod>(() => {
    const { year, month } = currentSystemYearMonth(system);
    return systemPeriod(system, year, month);
  });
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('branches').select('*'),
    ]).then(([empRes, brRes]) => {
      setEmployees(empRes.data ?? []);
      setBranches(brRes.data ?? []);
      setLoading(false);
    });
  }, []);

  // Toggling AD/BS resets to "this month" in the newly active system — the
  // salary math is monthly-flat so the period only labels the sheet.
  useEffect(() => {
    const { year, month } = currentSystemYearMonth(system);
    setPeriod(systemPeriod(system, year, month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);

  const periodOptions = useMemo(() => buildPeriodOptions(system, null, period), [system, period]);

  const branchName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of branches) m.set(b.id, b.name);
    return m;
  }, [branches]);

  const groups = useMemo(() => {
    const da = dearnessAllowance || 0;
    const rows: (SheetRow & { branch: string })[] = employees
      .filter(e => e.salary != null)
      .map(e => {
        const basic = e.salary!;
        const ssfEmployer = basic * SSF_EMPLOYER_RATE;
        const ssfEmployee = basic * SSF_EMPLOYEE_RATE;
        const mgs = basic + da + ssfEmployer;
        const totalSsf = ssfEmployer + ssfEmployee;
        return {
          id: e.id,
          name: e.name,
          designation: e.designation ?? '—',
          branch: e.branch_id ? branchName.get(e.branch_id) ?? 'Unassigned' : 'Unassigned',
          basic,
          dearness: da,
          ssfBasis: ssfEmployer,
          mgs,
          ssfEmployer,
          ssfEmployee,
          totalSsf,
          net: mgs - totalSsf,
        };
      });

    const byBranch = new Map<string, (SheetRow & { branch: string })[]>();
    for (const r of rows) {
      if (!byBranch.has(r.branch)) byBranch.set(r.branch, []);
      byBranch.get(r.branch)!.push(r);
    }
    return [...byBranch.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([branch, list]) => ({ branch, list: list.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [employees, branchName, dearnessAllowance]);

  const allRows = useMemo(() => groups.flatMap(g => g.list), [groups]);

  // Flat render list: a group header row, then its employee rows with a
  // running S.No. that carries across branches.
  const renderItems = useMemo(() => {
    const items: (
      | { kind: 'group'; branch: string }
      | { kind: 'row'; sno: number; row: SheetRow & { branch: string } }
    )[] = [];
    let sno = 0;
    for (const g of groups) {
      items.push({ kind: 'group', branch: g.branch });
      for (const r of g.list) {
        sno += 1;
        items.push({ kind: 'row', sno, row: r });
      }
    }
    return items;
  }, [groups]);

  const grand = useMemo(() => {
    const sum = (f: (r: SheetRow) => number) => allRows.reduce((s, r) => s + f(r), 0);
    return {
      basic: sum(r => r.basic),
      dearness: sum(r => r.dearness),
      ssfBasis: sum(r => r.ssfBasis),
      mgs: sum(r => r.mgs),
      ssfEmployer: sum(r => r.ssfEmployer),
      ssfEmployee: sum(r => r.ssfEmployee),
      totalSsf: sum(r => r.totalSsf),
      net: sum(r => r.net),
    };
  }, [allRows]);

  function exportCsv() {
    const header = [
      'S.No.',
      'Branch',
      'Employee Name',
      'Designation',
      'Basic Salary',
      'Dearness Allowance',
      'SSF 20% of Basic',
      'Monthly Gross (MGS)',
      'SSF by Employer 20%',
      'SSF by Employee 11%',
      'Total SSF Payable',
      'Net Monthly',
    ];
    let n = 0;
    const lines: (string | number)[][] = [];
    for (const g of groups) {
      for (const r of g.list) {
        n += 1;
        lines.push([
          n,
          g.branch,
          r.name,
          r.designation,
          r.basic.toFixed(2),
          r.dearness.toFixed(2),
          r.ssfBasis.toFixed(2),
          r.mgs.toFixed(2),
          r.ssfEmployer.toFixed(2),
          r.ssfEmployee.toFixed(2),
          r.totalSsf.toFixed(2),
          r.net.toFixed(2),
        ]);
      }
    }
    downloadExcel(`staff_salary_sheet_${period.key}.csv`, header, lines);
  }

  const th = 'whitespace-nowrap px-2.5 py-2 text-right align-bottom text-[11px] font-semibold uppercase leading-tight tracking-wide text-slate-500';
  const td = 'whitespace-nowrap px-2.5 py-1.5 text-right tabular-nums text-slate-700';

  return (
    <AppShell title="Payroll Report">
      {/* summary tiles — every figure is a total off the sheet below */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
        <div className="rounded-xl bg-info-bg p-3.5 shadow-sm ring-1 ring-inset ring-info/10">
          <span className="text-xs font-medium text-info-text/80">Total Basic Salary</span>
          <div className="mt-1 text-lg font-bold tabular-nums text-info-text">{money(grand.basic)}</div>
          <div className="mt-0.5 text-[11px] text-info-text/70">{allRows.length} staff</div>
        </div>
        <div className="rounded-xl bg-accent/10 p-3.5 shadow-sm ring-1 ring-inset ring-accent/10">
          <span className="text-xs font-medium text-accent/80">Total Dearness Allowance</span>
          <div className="mt-1 text-lg font-bold tabular-nums text-accent">{money(grand.dearness)}</div>
          <div className="mt-0.5 text-[11px] text-accent/70">{money(dearnessAllowance || 0)} flat / staff</div>
        </div>
        <div className="rounded-xl bg-warning-bg p-3.5 shadow-sm ring-1 ring-inset ring-warning/10">
          <span className="text-xs font-medium text-warning-text/80">Total SSF Payable</span>
          <div className="mt-1 text-lg font-bold tabular-nums text-warning-text">{money(grand.totalSsf)}</div>
          <div className="mt-0.5 text-[11px] text-warning-text/70">Employer 20% + Employee 11%</div>
        </div>
        <div className="rounded-xl bg-good-bg p-3.5 shadow-sm ring-1 ring-inset ring-good/10">
          <span className="text-xs font-medium text-good-text/80">Net Monthly Payable</span>
          <div className="mt-1 text-lg font-bold tabular-nums text-good-text">{money(grand.net)}</div>
          <div className="mt-0.5 text-[11px] text-good-text/70">Gross − Total SSF</div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white pb-2 shadow-sm print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-4 sm:px-6 print:hidden">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
              <SheetIcon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink">Staff Salary Sheet</h2>
              <p className="text-xs text-slate-500">
                {period.label} · {formatDdMmYyyy(period.start, system)} to {formatDdMmYyyy(period.end, system)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={period.key}
              onChange={e => {
                const found = periodOptions.find(o => o.key === e.target.value);
                if (found) setPeriod(found);
              }}
              className="rounded-lg border border-accent/30 bg-white px-3 py-2 text-sm font-bold text-ink shadow-sm"
            >
              {periodOptions.map(o => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <TableExportBar onExportCsv={exportCsv} />
        </div>

        {/* print-only masthead */}
        <div className="hidden px-4 pt-2 print:block sm:px-6">
          <h1 className="text-lg font-bold text-black">Staff Salary Sheet</h1>
          <p className="mt-1 text-[11px] text-black">
            Month: {period.label} · {formatDdMmYyyy(period.start, system)} to {formatDdMmYyyy(period.end, system)}
          </p>
        </div>

        <div className="mt-4 overflow-x-auto pb-2 print:overflow-visible">
          <table className="w-full text-right text-[12.5px]">
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50">
                <th className={`${th} w-10 text-center`}>S.No.</th>
                <th className={`${th} min-w-[10rem] text-left`}>Employee Name</th>
                <th className={`${th} min-w-[9rem] text-left`}>Designation</th>
                <th className={th}>
                  Basic Salary<br />
                  83/84
                </th>
                <th className={th}>
                  Dearness<br />
                  Allowance
                </th>
                <th className={th}>
                  SSF 20%<br />
                  of Basic
                </th>
                <th className={th}>
                  Monthly Gross<br />
                  Salary (MGS)
                </th>
                <th className={th}>
                  SSF by Employer<br />
                  20% of Basic
                </th>
                <th className={th}>
                  SSF by Employee<br />
                  11% — Deduction
                </th>
                <th className={th}>
                  Total SSF<br />
                  Payable
                </th>
                <th className={th}>Net Monthly</th>
              </tr>
            </thead>
            <tbody>
              {renderItems.map(item =>
                item.kind === 'group' ? (
                  <tr key={`g-${item.branch}`} className="bg-slate-100">
                    <td colSpan={11} className="px-2.5 py-1.5 text-left text-xs font-bold uppercase tracking-wide text-ink">
                      {item.branch}
                    </td>
                  </tr>
                ) : (
                  <tr key={item.row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-2.5 py-1.5 text-center tabular-nums text-slate-400">{item.sno}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-left font-medium text-ink">{item.row.name}</td>
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-left text-slate-500">{item.row.designation}</td>
                    <td className={td}>{money(item.row.basic)}</td>
                    <td className={td}>{money(item.row.dearness)}</td>
                    <td className={td}>{money(item.row.ssfBasis)}</td>
                    <td className={td}>{money(item.row.mgs)}</td>
                    <td className={td}>{money(item.row.ssfEmployer)}</td>
                    <td className={`${td} text-critical-text`}>{money(item.row.ssfEmployee)}</td>
                    <td className={td}>{money(item.row.totalSsf)}</td>
                    <td className={`${td} font-bold text-good-text`}>{money(item.row.net)}</td>
                  </tr>
                )
              )}
              {!loading && allRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                    No active employees with a salary set.
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
            {allRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 text-[12.5px] font-bold text-ink">
                  <td colSpan={3} className="px-2.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total
                  </td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.basic)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.dearness)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.ssfBasis)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.mgs)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.ssfEmployer)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-critical-text">{money(grand.ssfEmployee)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums">{money(grand.totalSsf)}</td>
                  <td className="px-2.5 py-2.5 text-right tabular-nums text-good-text">{money(grand.net)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {allRows.length > 0 && (
          <div className="flex flex-wrap justify-between gap-10 px-6 pb-4 pt-14 sm:px-10">
            {['Prepared By', 'Checked By', 'Approved By'].map(role => (
              <div key={role} className="w-52 max-w-[16rem] flex-1">
                <div className="border-t border-slate-400" />
                <div className="mt-1.5 text-center text-xs text-slate-500">{role}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function SheetIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6M9 9h2" />
    </svg>
  );
}
