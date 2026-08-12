'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Badge from '@/components/Badge';
import DateRangePicker from '@/components/DateRangePicker';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  isWeekOff,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from '@/lib/shift';
import type { AttendanceLog, Device, Employee, PayrollSummary, Shift } from '@/lib/types';

type Row = {
  key: string;
  date: string;
  enrollId: string;
  employeeName: string;
  device: string;
  shiftLabel: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming';
  lateMinutes: number;
  earlyMinutes: number;
  overtime: number;
  /** No payroll_summaries row yet (only computed by the nightly job or
   * "Recalculate month" on the Payroll page) — late/early/hours/overtime
   * here are computed live client-side from the raw punches (same math,
   * see lib/shift.ts) rather than left blank until that job runs. */
  pending?: boolean;
};

/** Decimal hours -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function statusBadge(r: Row) {
  if (r.checkIn) return <Badge tone="good">Present</Badge>;
  if (r.status === 'Upcoming') return <Badge tone="neutral">Upcoming</Badge>;
  return <Badge tone="critical">Absent</Badge>;
}

export default function AttendanceReportTable({ initialEmployeeId }: { initialEmployeeId?: string | null }) {
  const { system } = useCalendarSystem();
  const [from, setFrom] = useState(isoDaysAgo(0));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [status, setStatus] = useState<'All' | 'Present' | 'Late' | 'Early' | 'Absent'>('All');
  const [employeeId, setEmployeeId] = useState<string>(initialEmployeeId ?? 'all');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('employees').select('*').eq('status', 'active').order('name').then(({ data }) => setEmployees(data ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('payroll_summaries').select('*').gte('work_date', from).lte('work_date', to),
      supabase.from('attendance_logs').select('*').gte('punch_time', `${from}T00:00:00Z`).lte('punch_time', `${to}T23:59:59Z`),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', from).lte('work_date', to),
    ]).then(([summariesRes, logsRes, rosterRes]) => {
      setSummaries(summariesRes.data ?? []);
      setLogs(logsRes.data ?? []);
      setDailyShiftRows(rosterRes.data ?? []);
      setLoading(false);
    });
  }, [from, to]);

  const scopedEmployees = useMemo(
    () => (employeeId === 'all' ? employees : employees.filter(e => e.id === employeeId)),
    [employees, employeeId]
  );

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of dailyShiftRows) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(r.work_date, r.shift_id);
    }
    return map;
  }, [dailyShiftRows]);

  const rows: Row[] = useMemo(() => {
    const deviceName = (id: string | null) => devices.find(d => d.id === id)?.name ?? 'Mobile / QR / Selfie';
    const days: string[] = [];
    const cur = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const today = nepalTodayIso();

    // Per-employee: raw same-date bucketing, corrected for any day whose
    // resolved shift crosses midnight (Night Duty/Day & Night Duty) — done
    // once per employee up front (not inside the day×employee loop below)
    // since applyOvernightShiftCorrection needs a whole date range at once.
    const logsByEmployeeDay = new Map<string, Map<string, AttendanceLog[]>>();
    for (const emp of scopedEmployees) {
      const empLogs = logs.filter(l => l.employee_id === emp.id);
      const byDate = new Map<string, AttendanceLog[]>();
      for (const day of days) {
        const dayLogs = empLogs.filter(l => l.punch_time.slice(0, 10) === day);
        if (dayLogs.length > 0) byDate.set(day, dayLogs);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate);
      logsByEmployeeDay.set(emp.id, byDate);
    }

    const out: Row[] = [];
    for (const day of days) {
      for (const emp of scopedEmployees) {
        // Today's own row can still gain punches (e.g. a checkout) after a
        // payroll_summaries row for it was already computed — that row is
        // never re-run until tomorrow's nightly job, so trusting it here
        // would freeze today's attendance at whatever it looked like the
        // moment it was last computed. Always compute today live instead;
        // past days' summaries are final and safe to trust.
        const summary = day === today ? undefined : summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        const dayLogs = (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate);
        const shiftLabel = isWeekOff(resolved)
          ? 'Week Off'
          : `${resolved.name} (${resolved.start_time.slice(0, 5)}–${resolved.end_time.slice(0, 5)})`;

        if (summary) {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deviceName(dayLogs[0]?.device_id ?? null),
            shiftLabel,
            checkIn: summary.check_in,
            checkOut: summary.check_out,
            hours: summary.total_hours,
            status: summary.is_late ? 'Late' : 'Present',
            lateMinutes: summary.is_late ? summary.late_minutes : 0,
            earlyMinutes: summary.is_early_departure ? summary.early_departure_minutes : 0,
            overtime: summary.overtime_hours,
          });
        } else if (dayLogs.length > 0) {
          // Not yet processed by compute_payroll_summaries() (runs nightly
          // for the previous day, or manually via "Recalculate month" on
          // Payroll) — compute late/early/hours/overtime live from the raw
          // punches (same math payroll itself uses, see lib/shift.ts)
          // instead of leaving them blank until that job runs.
          const live = computeDayStatusForResolvedShift(dayLogs, resolved);
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deviceName(dayLogs[0].device_id ?? null),
            shiftLabel,
            checkIn: live.checkIn.punch_time,
            checkOut: live.checkOut?.punch_time ?? null,
            hours: live.totalMinutes / 60,
            status: live.isLate ? 'Late' : 'Present',
            lateMinutes: live.lateMinutes,
            earlyMinutes: live.earlyMinutes,
            overtime: live.overtimeMinutes / 60,
            pending: true,
          });
        } else {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: 'N/A',
            shiftLabel,
            checkIn: null,
            checkOut: null,
            hours: 0,
            // A day that hasn't happened yet isn't "Absent" — it just
            // hasn't occurred (only relevant if the picked range runs past
            // today).
            status: day > today ? 'Upcoming' : 'Absent',
            lateMinutes: 0,
            earlyMinutes: 0,
            overtime: 0,
          });
        }
      }
    }
    return out
      .filter(r => status === 'All' || (status === 'Early' ? r.earlyMinutes > 0 : r.status === status))
      .sort((a, b) => {
        const aId = a.enrollId ?? '';
        const bId = b.enrollId ?? '';
        if (!aId && !bId) return 0;
        if (!aId) return 1;
        if (!bId) return -1;
        return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [scopedEmployees, summaries, logs, devices, shifts, from, to, status, dailyShiftByDate]);

  const totals = useMemo(() => {
    const workHours = rows.reduce((sum, r) => sum + r.hours, 0);
    const overtimeHours = rows.reduce((sum, r) => sum + r.overtime, 0);
    const lateMinutes = rows.reduce((sum, r) => sum + r.lateMinutes, 0);
    const earlyMinutes = rows.reduce((sum, r) => sum + r.earlyMinutes, 0);
    const presentDays = rows.filter(r => r.checkIn).length;
    const absentDays = rows.filter(r => !r.checkIn && r.status !== 'Upcoming').length;
    return { workHours, overtimeHours, lateMinutes, earlyMinutes, presentDays, absentDays };
  }, [rows]);

  function exportCsv() {
    const header = [
      'Date',
      'ID',
      'Employee',
      'Shift',
      'Check-In',
      'Check-Out',
      'Late By (min)',
      'Early Out (min)',
      'Total Work Hours',
      'Overtime',
      'Status',
      'Device',
    ];
    const lines = rows.map(r =>
      [
        r.date,
        r.enrollId,
        r.employeeName,
        r.shiftLabel,
        r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour12: false }) : '',
        r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour12: false }) : '',
        r.lateMinutes || '',
        r.earlyMinutes || '',
        r.hours.toFixed(1),
        r.overtime.toFixed(1),
        r.status,
        r.device,
      ]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Employee</label>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <PersonIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent" />
                <select
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  className="min-w-[10rem] rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="all">All Employees</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name} (ID {e.fingerprint_id ?? '—'})
                    </option>
                  ))}
                </select>
              </div>
              {employeeId !== 'all' && (
                <button onClick={() => setEmployeeId('all')} className="text-[11px] font-medium text-accent hover:underline">
                  Clear
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</label>
            <div className="relative">
              <StatusIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent" />
              <select
                value={status}
                onChange={e => setStatus(e.target.value as typeof status)}
                className="rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="All">All Logs</option>
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="Late">Late</option>
                <option value="Early">Early</option>
              </select>
            </div>
          </div>

          <div className="hidden h-8 w-px bg-slate-200 sm:block" />

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Date Range</label>
            <div className="w-48">
              <DateRangePicker from={from} to={to} onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }} />
            </div>
          </div>

          <button
            onClick={exportCsv}
            className="ml-auto flex items-center gap-1 rounded-md border border-accent bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent shadow-sm transition-colors hover:bg-accent hover:text-white"
          >
            ⭳ Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {/* Same left-to-right table on every screen size, including phones —
            horizontal scroll instead of a condensed/truncated mobile layout,
            so it always matches the desktop web view exactly. */}
        <div className="max-h-[65vh] overflow-auto rounded-lg">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Date</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">ID</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Employee</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Shift</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">In / Out</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Late / Early</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Work Hours</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Overtime</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Status</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Device</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">{formatAdDate(r.date, system)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">{r.enrollId}</td>
                <td className="whitespace-nowrap px-2 py-1 font-medium text-ink">{r.employeeName}</td>
                <td className="px-2 py-1 whitespace-nowrap text-slate-600">{r.shiftLabel}</td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">
                  {r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '–:–'}
                  {' – '}
                  {r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '–:–'}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {r.lateMinutes === 0 && r.earlyMinutes === 0 && <span className="text-slate-400">—</span>}
                  {r.lateMinutes > 0 && (
                    <span className="font-medium text-warning-text">L {formatHoursMinutes(r.lateMinutes)}</span>
                  )}
                  {r.lateMinutes > 0 && r.earlyMinutes > 0 && ' · '}
                  {r.earlyMinutes > 0 && (
                    <span className="font-medium text-critical-text">E {formatHoursMinutes(r.earlyMinutes)}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">
                  {fmtHrs(r.hours)}
                  {r.pending && <span className="ml-1 text-[9px] text-slate-400">(live)</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">
                  {fmtHrs(r.overtime)}
                  {r.pending && <span className="ml-1 text-[9px] text-slate-400">(live)</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {statusBadge(r)}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">{r.device}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                  {loading ? 'Loading…' : 'No records in this range.'}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 border-t-2 border-slate-200 bg-slate-50 text-xs font-bold text-ink">
                <td colSpan={4} className="whitespace-nowrap px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Total
                </td>
                <td />
                <td className="whitespace-nowrap px-2 py-1.5 text-[10px]">
                  {totals.lateMinutes > 0 && <span className="text-warning-text">L {formatHoursMinutes(totals.lateMinutes)}</span>}
                  {totals.lateMinutes > 0 && totals.earlyMinutes > 0 && ' · '}
                  {totals.earlyMinutes > 0 && <span className="text-critical-text">E {formatHoursMinutes(totals.earlyMinutes)}</span>}
                  {totals.lateMinutes === 0 && totals.earlyMinutes === 0 && '—'}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">{fmtHrs(totals.workHours)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{fmtHrs(totals.overtimeHours)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-[10px] font-semibold">
                  <span className="text-good-text">{totals.presentDays} present</span>
                  {' · '}
                  <span className="text-critical-text">{totals.absentDays} absent</span>
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>
    </>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
    </svg>
  );
}

function StatusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16M4 5l7 8v6l2 1v-7l7-8" />
    </svg>
  );
}
