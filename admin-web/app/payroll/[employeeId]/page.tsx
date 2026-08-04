'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import { buildMonth, formatAdDate, formatDdMmYyyy, todayAnchor, type CalendarAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatHoursMinutes } from '@/lib/shift';
import { buildEmployeeDayRows, dailySalaryEarning } from '@/lib/payrollDetail';
import type { AttendanceLog, Employee, PayrollSummary, Shift } from '@/lib/types';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Decimal hours (e.g. d.hours, d.overtime) -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

function parseAdKey(value: string): CalendarAnchor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

function startOfMonthIso() {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
}

export default function PayrollEmployeeDetailPage() {
  return (
    <Suspense fallback={null}>
      <PayrollEmployeeDetailView />
    </Suspense>
  );
}

function PayrollEmployeeDetailView() {
  const { system } = useCalendarSystem();
  const params = useParams<{ employeeId: string }>();
  const searchParams = useSearchParams();
  const employeeId = params.employeeId;

  // The period and overtime settings come from whichever Payroll page link
  // was clicked — this page has no period picker of its own, it always
  // shows exactly the period the admin was looking at. Falls back to the
  // current AD month + Payroll's own defaults if opened without them.
  const start = searchParams.get('start') ?? startOfMonthIso();
  const end = searchParams.get('end') ?? todayIso();
  const otHoursPerDay = Number(searchParams.get('otHoursPerDay') ?? 8) || 8;
  const otMultiplier = Number(searchParams.get('otMultiplier') ?? 1.5) || 1.5;
  const otOn = searchParams.get('otOn') !== 'false';

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('employees').select('*').eq('id', employeeId).single(),
      supabase.from('shifts').select('*'),
      supabase.from('payroll_summaries').select('*').eq('employee_id', employeeId).gte('work_date', start).lte('work_date', end),
      supabase
        .from('attendance_logs')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('punch_time', `${start}T00:00:00Z`)
        .lte('punch_time', `${end}T23:59:59Z`),
    ]).then(([empRes, shiftsRes, summariesRes, logsRes]) => {
      setEmployee(empRes.data ?? null);
      setShifts(shiftsRes.data ?? []);
      setSummaries(summariesRes.data ?? []);
      setLogs(logsRes.data ?? []);
      setLoading(false);
    });
  }, [employeeId, start, end]);

  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);
  const monthLabel = useMemo(() => buildMonth(system, parseAdKey(start) ?? todayAnchor()).label, [system, start]);
  // The flat "salary ÷ days in period" rate — same figure on every row,
  // shown for reference next to My Salary/OT Salary which are earned per
  // hour instead (see dailySalaryEarning() in lib/payrollDetail.ts).
  const salaryPerDay = useMemo(() => (employee?.salary != null ? employee.salary / daysInRange : null), [employee, daysInRange]);

  const dayRows = useMemo(() => (employee ? buildEmployeeDayRows(employee, shifts, summaries, logs, start, end) : []), [
    employee,
    shifts,
    summaries,
    logs,
    start,
    end,
  ]);

  const dayTotals = useMemo(() => {
    let hours = 0;
    let overtime = 0;
    let lateMinutes = 0;
    let earlyMinutes = 0;
    let mySalary = 0;
    let otSalary = 0;
    let totalSalary = 0;
    let presentDays = 0;
    let absentDays = 0;
    for (const d of dayRows) {
      hours += d.hours;
      overtime += d.overtime;
      lateMinutes += d.lateMinutes;
      earlyMinutes += d.earlyMinutes;
      if (d.checkIn) presentDays += 1;
      else absentDays += 1;
      const earning = dailySalaryEarning(d, employee?.salary ?? null, daysInRange, otHoursPerDay, otMultiplier, otOn);
      if (earning) {
        mySalary += earning.base;
        otSalary += earning.overtime;
        totalSalary += earning.total;
      }
    }
    return { hours, overtime, lateMinutes, earlyMinutes, mySalary, otSalary, totalSalary, presentDays, absentDays };
  }, [dayRows, employee, daysInRange, otHoursPerDay, otMultiplier, otOn]);


  const periodQuery = `?start=${start}&end=${end}&otHoursPerDay=${otHoursPerDay}&otMultiplier=${otMultiplier}&otOn=${otOn}`;

  return (
    <AppShell title={employee ? employee.name : 'Payroll Detail'}>
      <Link
        href={`/payroll${periodQuery}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-accent"
      >
        <BackIcon className="h-4 w-4" />
        Back to Payroll
      </Link>

      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employee ? (
        <p className="text-center text-sm text-critical">Employee not found.</p>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent p-4 shadow-sm sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-base font-bold text-white">
                {employee.name
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map(part => part[0]!.toUpperCase())
                  .join('')}
              </span>
              <div>
                <h2 className="text-lg font-bold text-ink">{employee.name}</h2>
                <p className="text-xs text-slate-500">ID {employee.fingerprint_id ?? '—'}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="rounded-lg border border-accent/30 bg-white px-3 py-2 text-sm font-bold text-ink shadow-sm">{monthLabel}</div>
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-sm">
                <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
                {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)}
                <span className="text-slate-400">({daysInRange}d)</span>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2.5 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-4 sm:px-6">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white">
                <ReportIcon className="h-5 w-5" />
              </span>
              <h3 className="text-lg font-bold text-ink">{monthLabel} Breakdown</h3>
            </div>

            {/* Phones get a card per day, desktop gets the full table. */}
            <div className="mt-3 divide-y divide-slate-100 p-4 md:hidden">
              {dayRows.map(d => {
                const earning = dailySalaryEarning(d, employee.salary, daysInRange, otHoursPerDay, otMultiplier, otOn);
                return (
                  <div key={d.date} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{formatAdDate(d.date, system)}</span>
                      {d.checkIn ? <Badge tone="good">Present</Badge> : <Badge tone="critical">Absent</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>
                        {d.checkIn ? fmtTime(d.checkIn) : '–:–'} – {d.checkOut ? fmtTime(d.checkOut) : '–:–'}
                      </span>
                      <span>
                        {fmtHrs(d.hours)}{d.pending && ' (live)'}
                      </span>
                      {d.overtime > 0 && <span className="font-medium text-info-text">OT {fmtHrs(d.overtime)}</span>}
                      {d.lateMinutes > 0 && <span className="font-medium text-warning-text">Late {formatHoursMinutes(d.lateMinutes)}</span>}
                      {d.earlyMinutes > 0 && <span className="font-medium text-critical-text">Early {formatHoursMinutes(d.earlyMinutes)}</span>}
                    </div>
                    {earning && (
                      <div className="mt-1.5 flex items-center justify-between text-xs">
                        <span className="text-slate-400">
                          My Salary {Math.round(earning.base).toLocaleString()}
                          {earning.overtime > 0 && ` + OT Salary ${Math.round(earning.overtime).toLocaleString()}`}
                        </span>
                        <span className="font-semibold text-good-text">{Math.round(earning.total).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {dayRows.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No days in this period.</p>}
              {dayRows.length > 0 && (
                <div className="-mx-4 mt-1 flex items-center justify-center gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs font-semibold">
                  <span className="text-good-text">{dayTotals.presentDays} present</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-critical-text">{dayTotals.absentDays} absent</span>
                </div>
              )}
            </div>

            <div className="mt-4 hidden overflow-x-auto pb-2 md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-4 py-2 font-medium">Date</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">Check-In</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">Check-Out</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">Total Hours</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">Overtime</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">Late By</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">Early Out</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">Status</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">Salary/Day</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">My Salary</th>
                    <th className="whitespace-nowrap px-4 py-2 font-medium">OT Salary</th>
                    <th className="sticky right-0 z-20 whitespace-nowrap bg-slate-50 px-4 py-2 font-medium shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)]">
                      Total Salary
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((d, i) => {
                    const earning = dailySalaryEarning(d, employee.salary, daysInRange, otHoursPerDay, otMultiplier, otOn);
                    const rowBg = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                    return (
                      <tr key={d.date} className={`border-b border-slate-100 last:border-0 ${i % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{formatAdDate(d.date, system)}</td>
                        <td className="px-4 py-2 text-slate-600">{d.checkIn ? fmtTime(d.checkIn) : '–:–'}</td>
                        <td className="px-4 py-2 text-slate-600">{d.checkOut ? fmtTime(d.checkOut) : '–:–'}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {fmtHrs(d.hours)}{d.pending && <span className="ml-1 text-[10px] text-slate-400">(live)</span>}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{fmtHrs(d.overtime)}</td>
                        <td className="px-4 py-2">
                          {d.lateMinutes > 0 ? (
                            <span className="font-medium text-warning-text">{formatHoursMinutes(d.lateMinutes)}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {d.earlyMinutes > 0 ? (
                            <span className="font-medium text-critical-text">{formatHoursMinutes(d.earlyMinutes)}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {d.checkIn ? <Badge tone="good">Present</Badge> : <Badge tone="critical">Absent</Badge>}
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          {salaryPerDay != null ? Math.round(salaryPerDay).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{earning ? Math.round(earning.base).toLocaleString() : '—'}</td>
                        <td className="px-4 py-2 text-slate-600">{earning ? Math.round(earning.overtime).toLocaleString() : '—'}</td>
                        <td
                          className={`sticky right-0 z-[1] whitespace-nowrap px-4 py-2 font-bold text-good-text shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)] ${rowBg}`}
                        >
                          {earning ? Math.round(earning.total).toLocaleString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {dayRows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                        No days in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
                {dayRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 text-sm font-bold text-ink">
                      <td colSpan={3} className="whitespace-nowrap px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Total
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">{fmtHrs(dayTotals.hours)}</td>
                      <td className="whitespace-nowrap px-4 py-2">{fmtHrs(dayTotals.overtime)}</td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {dayTotals.lateMinutes > 0 ? formatHoursMinutes(dayTotals.lateMinutes) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {dayTotals.earlyMinutes > 0 ? formatHoursMinutes(dayTotals.earlyMinutes) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs font-semibold">
                        <span className="text-good-text">{dayTotals.presentDays}P</span>
                        {' / '}
                        <span className="text-critical-text">{dayTotals.absentDays}A</span>
                      </td>
                      <td />
                      <td className="whitespace-nowrap px-4 py-2">{Math.round(dayTotals.mySalary).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-4 py-2">{Math.round(dayTotals.otSalary).toLocaleString()}</td>
                      <td className="sticky right-0 z-20 whitespace-nowrap bg-slate-50 px-4 py-2 text-good-text shadow-[-6px_0_6px_-4px_rgba(0,0,0,0.08)]">
                        {Math.round(dayTotals.totalSalary).toLocaleString()}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
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

function ReportIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M9 13h6M9 17h6M9 9h2" />
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
