'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import { formatAdDate, formatDdMmYyyy } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { formatMinutes } from '@/lib/shift';
import { buildEmployeeDayRows, dailySalaryEarning } from '@/lib/payrollDetail';
import type { AttendanceLog, Employee, PayrollSummary, Shift } from '@/lib/types';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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

  const dayRows = useMemo(() => (employee ? buildEmployeeDayRows(employee, shifts, summaries, logs, start, end) : []), [
    employee,
    shifts,
    summaries,
    logs,
    start,
    end,
  ]);

  const totals = useMemo(() => {
    const workedDays = dayRows.filter(d => d.status !== 'Absent').length;
    const hours = dayRows.reduce((s, d) => s + d.hours, 0);
    const overtime = dayRows.reduce((s, d) => s + d.overtime, 0);
    const salary = employee?.salary ?? null;
    const hourlyRate = salary != null ? salary / (daysInRange * otHoursPerDay) : null;
    // Pay is earned per hour actually worked, not per day shown up — see
    // dailySalaryEarning() in lib/payrollDetail.ts for the same math applied
    // per-day (regular hours = total hours minus the overtime portion
    // already folded into them, so overtime isn't paid twice).
    const calculatedSalary = hourlyRate != null ? Math.round(hourlyRate * Math.max(0, hours - overtime)) : null;
    const overtimeSalary = salary != null ? (otOn && overtime > 0 && hourlyRate != null ? Math.round(hourlyRate * otMultiplier * overtime) : 0) : null;
    const totalSalary = calculatedSalary != null ? calculatedSalary + (overtimeSalary ?? 0) : null;
    return { workedDays, hours, overtime, calculatedSalary, overtimeSalary, totalSalary };
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
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div>
              <h2 className="text-lg font-semibold text-ink">{employee.name}</h2>
              <p className="text-xs text-slate-500">
                ID {employee.fingerprint_id ?? '—'} · {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)} ({daysInRange}d)
              </p>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-6">
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Days</div>
              <div className="text-base font-bold text-ink">{totals.workedDays}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Hours</div>
              <div className="text-base font-bold text-ink">{totals.hours.toFixed(1)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Overtime</div>
              <div className="text-base font-bold text-ink">{totals.overtime.toFixed(1)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Salary</div>
              <div className="text-base font-bold text-ink">{totals.calculatedSalary != null ? totals.calculatedSalary.toLocaleString() : '—'}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">OT Salary</div>
              <div className="text-base font-bold text-ink">{totals.overtimeSalary != null ? totals.overtimeSalary.toLocaleString() : '—'}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
              <div className="text-[11px] uppercase tracking-wide text-slate-400">Total</div>
              <div className="text-base font-bold text-accent">{totals.totalSalary != null ? totals.totalSalary.toLocaleString() : '—'}</div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <h3 className="px-4 pt-4 text-base font-semibold text-ink sm:px-6 sm:pt-6">
              Day 1–{daysInRange} Breakdown
            </h3>

            {/* Phones get a card per day, desktop gets the full table. */}
            <div className="mt-3 divide-y divide-slate-100 p-4 md:hidden">
              {dayRows.map(d => {
                const earning = dailySalaryEarning(d, employee.salary, daysInRange, otHoursPerDay, otMultiplier, otOn);
                return (
                  <div key={d.date} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-ink">{formatAdDate(d.date, system)}</span>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Badge tone={d.status === 'Present' ? 'good' : d.status === 'Late' ? 'warning' : 'critical'}>{d.status}</Badge>
                        {d.status !== 'Present' && d.checkIn && d.checkOut && <Badge tone="good">Present</Badge>}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>
                        {d.checkIn ? fmtTime(d.checkIn) : '–:–'} – {d.checkOut ? fmtTime(d.checkOut) : '–:–'}
                      </span>
                      <span>
                        {d.hours.toFixed(1)}h{d.pending && ' (live)'}
                      </span>
                      {d.overtime > 0 && <span className="font-medium text-info-text">OT {d.overtime.toFixed(1)}h</span>}
                      {d.lateMinutes > 0 && <span className="font-medium text-warning-text">Late {formatMinutes(d.lateMinutes)}</span>}
                      {d.earlyMinutes > 0 && <span className="font-medium text-warning-text">Early {formatMinutes(d.earlyMinutes)}</span>}
                    </div>
                    {earning && (
                      <div className="mt-1.5 flex items-center justify-between text-xs">
                        <span className="text-slate-400">
                          Salary {Math.round(earning.base).toLocaleString()}
                          {earning.overtime > 0 && ` + OT ${Math.round(earning.overtime).toLocaleString()}`}
                        </span>
                        <span className="font-semibold text-ink">{Math.round(earning.total).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {dayRows.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No days in this period.</p>}
            </div>

            <div className="mt-4 hidden overflow-x-auto pb-2 md:block">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Date</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Check-In</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Check-Out</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Total Hours</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Overtime</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Late By</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Status</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Calculated Salary</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Overtime Salary</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Total Salary</th>
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map(d => {
                    const earning = dailySalaryEarning(d, employee.salary, daysInRange, otHoursPerDay, otMultiplier, otOn);
                    return (
                      <tr key={d.date} className="border-b border-slate-100 last:border-0">
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatAdDate(d.date, system)}</td>
                        <td className="px-4 py-3 text-slate-600">{d.checkIn ? fmtTime(d.checkIn) : '–:–'}</td>
                        <td className="px-4 py-3 text-slate-600">{d.checkOut ? fmtTime(d.checkOut) : '–:–'}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {d.hours.toFixed(1)} hrs{d.pending && <span className="ml-1 text-[10px] text-slate-400">(live)</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{d.overtime.toFixed(1)} hrs</td>
                        <td className="px-4 py-3">
                          {d.lateMinutes > 0 ? (
                            <span className="font-medium text-warning-text">{formatMinutes(d.lateMinutes)}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <Badge tone={d.status === 'Present' ? 'good' : d.status === 'Late' ? 'warning' : 'critical'}>{d.status}</Badge>
                            {d.status !== 'Present' && d.checkIn && d.checkOut && <Badge tone="good">Present</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{earning ? Math.round(earning.base).toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{earning ? Math.round(earning.overtime).toLocaleString() : '—'}</td>
                        <td className="px-4 py-3 font-medium text-ink">{earning ? Math.round(earning.total).toLocaleString() : '—'}</td>
                      </tr>
                    );
                  })}
                  {dayRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                        No days in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}
