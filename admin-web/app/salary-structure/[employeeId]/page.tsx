'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import DatePicker from '@/components/DatePicker';
import TableExportBar, { downloadExcel } from '@/components/TableExportBar';
import SalaryBreakdown, { computeSalaryFigures, salaryBreakdownLines } from '@/components/SalaryBreakdown';
import { formatAdDate, monthDateRange } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso } from '@/lib/shift';
import { fetchMyCompanyWeekOffConfig } from '@/lib/weekOff';
import type { Employee } from '@/lib/types';

export default function SalaryStructureEmployeePage() {
  return (
    <Suspense fallback={null}>
      <SalaryStructureEmployeeView />
    </Suspense>
  );
}

function SalaryStructureEmployeeView() {
  const { system } = useCalendarSystem();
  const params = useParams<{ employeeId: string }>();
  const searchParams = useSearchParams();
  const employeeId = params.employeeId;

  // Seeded from the list page's link (the date/view the admin was looking
  // at), then editable here with the page's own date picker.
  const [asOfDate, setAsOfDate] = useState(() => searchParams.get('asOf') || nepalTodayIso());
  const listQuery = `?asOf=${asOfDate}&view=${searchParams.get('view') || 'monthly'}`;

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [rates, setRates] = useState({ pf: 10, ssf: 11, tds: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMyCompanyWeekOffConfig().then(({ pfRate, ssfRate, tdsRate }) => {
      setRates({ pf: pfRate, ssf: ssfRate, tds: tdsRate });
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .single()
      .then(({ data }) => {
        setEmployee(data ?? null);
        setLoading(false);
      });
  }, [employeeId]);

  const { pf, ssf, tds } = rates;

  const daysInMonth = useMemo(() => {
    const [y, m, d] = asOfDate.split('-').map(Number);
    if (!y || !m || !d) return 30;
    const { start, end } = monthDateRange(system, { year: y, month: m - 1, day: d });
    return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  }, [asOfDate, system]);

  const figures = useMemo(
    () => computeSalaryFigures(employee?.salary ?? null, employee?.allowance ?? null, pf, ssf, tds),
    [employee, pf, ssf, tds]
  );

  const dateLabel = formatAdDate(asOfDate, system);

  function exportCsv() {
    if (!employee) return;
    const lines = salaryBreakdownLines(figures, pf, ssf, tds).map(l => [
      l.label,
      l.value == null ? '' : l.value,
      l.value == null ? '' : Number((l.value / daysInMonth).toFixed(2)),
    ]);
    downloadExcel(
      `salary_structure_${employee.name.replace(/\s+/g, '_')}_${asOfDate}.csv`,
      ['Component', 'Per month', `Per day (${dateLabel})`],
      lines
    );
  }

  const tiles: { label: string; value: number | null; tone: string }[] = [
    { label: 'Gross Pay', value: figures.gross, tone: 'bg-info-bg text-info-text ring-info/10' },
    { label: 'Total Deductions', value: figures.pfAmt == null ? null : figures.pfAmt + figures.ssfAmt! + figures.tdsAmt!, tone: 'bg-critical-bg text-critical-text ring-critical/10' },
    { label: 'Net Payable', value: figures.net, tone: 'bg-good-bg text-good-text ring-good/10' },
  ];

  return (
    <AppShell title={employee ? employee.name : 'Salary Structure'}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/salary-structure${listQuery}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-accent">
          <BackIcon className="h-4 w-4" />
          Back to Salary Structure
        </Link>
        <div className="flex flex-wrap items-center gap-2.5">
          <DatePicker value={asOfDate} onChange={setAsOfDate} className="w-44" />
          {employee && <TableExportBar onExportCsv={exportCsv} />}
        </div>
      </div>

      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employee ? (
        <p className="text-center text-sm text-critical">Employee not found.</p>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent p-4 shadow-sm sm:p-6 print:border-slate-300 print:shadow-none">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-white">
                {employee.name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('')}
              </span>
              <div>
                <h2 className="text-lg font-bold text-ink">{employee.name}</h2>
                <p className="text-xs font-medium text-slate-500">
                  {employee.designation || 'Salary structure'}
                  {employee.employee_code && ` · #${employee.employee_code}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-sm">
              <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
              As of {dateLabel} · {daysInMonth}-day month
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {tiles.map(t => (
              <div key={t.label} className={`rounded-xl p-3 shadow-sm ring-1 ring-inset ${t.tone}`}>
                <span className="text-xs font-medium opacity-80">{t.label}</span>
                <div className="mt-1 text-base font-bold">{t.value != null ? t.value.toLocaleString() : '—'}</div>
                <div className="mt-0.5 text-[11px] opacity-70">
                  {t.value != null ? `${(t.value / daysInMonth).toLocaleString(undefined, { maximumFractionDigits: 2 })} / day` : 'No salary set'}
                </div>
              </div>
            ))}
          </div>

          <h1 className="mb-2 hidden text-lg font-bold text-ink print:block">
            {employee.name} — Salary Structure (as of {dateLabel})
          </h1>

          <SalaryBreakdown
            employee={employee}
            figures={figures}
            pf={pf}
            ssf={ssf}
            tds={tds}
            daysInMonth={daysInMonth}
            asOfDate={asOfDate}
            system={system}
          />

          <p className="mt-3 text-xs text-slate-400">
            Net Payable = Basic + Allowance − PF − SSF − TDS. Basic and Allowance are set on the Salary Structure list; PF /
            SSF / TDS are company-wide rates. Per-day figures divide the monthly amount by the {daysInMonth} days in{' '}
            {dateLabel}&apos;s calendar month. Overtime, where earned, is added on top on the Payroll report.
          </p>
        </>
      )}
    </AppShell>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}
