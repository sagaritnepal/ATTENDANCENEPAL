'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { AttendanceLog, Device, Employee, PayrollSummary } from '@/lib/types';

type Row = {
  key: string;
  date: string;
  employeeName: string;
  device: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  status: 'Present' | 'Late' | 'Absent';
  lateMinutes: number;
  earlyMinutes: number;
  overtime: number;
  /** No payroll_summaries row yet (only computed by the nightly job or
   * "Recalculate month" on the Payroll page) — hours/late status aren't
   * final, this row is built straight from today's raw punches so it's
   * not invisible until that recompute runs. */
  pending?: boolean;
};

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoWeekStart() {
  const d = new Date();
  const day = d.getUTCDay(); // 0 = Sun … 6 = Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

function isoMonthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

const PRESETS = [
  { key: 'today', label: 'Today', from: () => isoDaysAgo(0), to: () => isoDaysAgo(0) },
  { key: 'week', label: 'This Week', from: isoWeekStart, to: () => isoDaysAgo(0) },
  { key: 'month', label: 'This Month', from: isoMonthStart, to: () => isoDaysAgo(0) },
] as const;

export default function AttendancePage() {
  return (
    <Suspense fallback={null}>
      <AttendanceView />
    </Suspense>
  );
}

function AttendanceView() {
  const { system } = useCalendarSystem();
  const searchParams = useSearchParams();
  const initialEmployeeId = searchParams.get('employee');
  const [from, setFrom] = useState(isoDaysAgo(6));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [status, setStatus] = useState<'All' | 'Present' | 'Late' | 'Absent'>('All');
  const [employeeId, setEmployeeId] = useState<string>(initialEmployeeId ?? 'all');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    supabase.from('employees').select('*').eq('status', 'active').order('name').then(({ data }) => setEmployees(data ?? []));
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
  }, []);

  useEffect(() => {
    supabase
      .from('payroll_summaries')
      .select('*')
      .gte('work_date', from)
      .lte('work_date', to)
      .then(({ data }) => setSummaries(data ?? []));
    supabase
      .from('attendance_logs')
      .select('*')
      .gte('punch_time', `${from}T00:00:00Z`)
      .lte('punch_time', `${to}T23:59:59Z`)
      .then(({ data }) => setLogs(data ?? []));
  }, [from, to]);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setFrom(preset.from());
    setTo(preset.to());
    setActivePreset(preset.key);
  }

  const scopedEmployees = useMemo(
    () => (employeeId === 'all' ? employees : employees.filter(e => e.id === employeeId)),
    [employees, employeeId]
  );

  const rows: Row[] = useMemo(() => {
    const deviceName = (id: string | null) => devices.find(d => d.id === id)?.name ?? 'Mobile / QR / Selfie';
    const days: string[] = [];
    const cur = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const out: Row[] = [];
    for (const day of days) {
      for (const emp of scopedEmployees) {
        const summary = summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        const dayLogs = logs
          .filter(l => l.employee_id === emp.id && l.punch_time.slice(0, 10) === day)
          .sort((a, b) => a.punch_time.localeCompare(b.punch_time));

        if (summary) {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            employeeName: emp.name,
            device: deviceName(dayLogs[0]?.device_id ?? null),
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
          // Payroll) — show the raw punches now rather than "Absent" until
          // final hours/late status are computed.
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            employeeName: emp.name,
            device: deviceName(dayLogs[0].device_id ?? null),
            checkIn: dayLogs[0].punch_time,
            checkOut: dayLogs.length > 1 ? dayLogs[dayLogs.length - 1].punch_time : null,
            hours: 0,
            status: 'Present',
            lateMinutes: 0,
            earlyMinutes: 0,
            overtime: 0,
            pending: true,
          });
        } else {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            employeeName: emp.name,
            device: 'N/A',
            checkIn: null,
            checkOut: null,
            hours: 0,
            status: 'Absent',
            lateMinutes: 0,
            earlyMinutes: 0,
            overtime: 0,
          });
        }
      }
    }
    return out.filter(r => status === 'All' || r.status === status).sort((a, b) => b.date.localeCompare(a.date));
  }, [scopedEmployees, summaries, logs, devices, from, to, status]);

  const totals = useMemo(() => {
    const workHours = rows.reduce((sum, r) => sum + (r.pending ? 0 : r.hours), 0);
    const overtimeHours = rows.reduce((sum, r) => sum + (r.pending ? 0 : r.overtime), 0);
    const lateMinutes = rows.reduce((sum, r) => sum + r.lateMinutes, 0);
    const earlyMinutes = rows.reduce((sum, r) => sum + r.earlyMinutes, 0);
    return { workHours, overtimeHours, lateMinutes, earlyMinutes };
  }, [rows]);

  function exportCsv() {
    const header = [
      'Date',
      'Employee',
      'Device',
      'Check-In',
      'Check-Out',
      'Late By (min)',
      'Early Out (min)',
      'Total Work Hours',
      'Overtime',
      'Status',
    ];
    const lines = rows.map(r =>
      [
        r.date,
        r.employeeName,
        r.device,
        r.checkIn ? new Date(r.checkIn).toLocaleTimeString() : '',
        r.checkOut ? new Date(r.checkOut).toLocaleTimeString() : '',
        r.lateMinutes || '',
        r.earlyMinutes || '',
        r.hours.toFixed(1),
        r.overtime.toFixed(1),
        r.status,
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
    <AppShell title="Attendance Report">
      <div className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
            className="min-w-[10rem] rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All Employees</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          {employeeId !== 'all' && (
            <button onClick={() => setEmployeeId('all')} className="text-xs font-medium text-accent hover:underline">
              Clear employee filter
            </button>
          )}

          <select
            value={status}
            onChange={e => setStatus(e.target.value as typeof status)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="All">All Logs</option>
            <option value="Present">Present</option>
            <option value="Late">Late</option>
            <option value="Absent">Absent</option>
          </select>

          <button
            onClick={exportCsv}
            className="ml-auto rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ⭳ Export CSV
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <div className="flex gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  activePreset === p.key ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-xs font-medium text-slate-500">Pick date manually</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">From</span>
            <div className="w-48">
              <DatePicker
                value={from}
                onChange={v => {
                  setFrom(v);
                  setActivePreset(null);
                }}
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">To</span>
            <div className="w-48">
              <DatePicker
                value={to}
                onChange={v => {
                  setTo(v);
                  setActivePreset(null);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-h-[65vh] overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="px-5 py-3 font-medium">Device</th>
              <th className="px-5 py-3 font-medium">Check-In</th>
              <th className="px-5 py-3 font-medium">Check-Out</th>
              <th className="px-5 py-3 font-medium">Late By</th>
              <th className="px-5 py-3 font-medium">Early Out</th>
              <th className="px-5 py-3 font-medium">Total Work Hours</th>
              <th className="px-5 py-3 font-medium">Overtime</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 text-slate-600">{formatAdDate(r.date, system)}</td>
                <td className="px-5 py-3 font-medium text-ink">{r.employeeName}</td>
                <td className="px-5 py-3 text-slate-600">{r.device}</td>
                <td className="px-5 py-3 text-slate-600">{r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–:–'}</td>
                <td className="px-5 py-3 text-slate-600">{r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–:–'}</td>
                <td className="px-5 py-3">
                  {r.lateMinutes > 0 ? (
                    <span className="font-medium text-warning-text">{r.lateMinutes} min</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {r.earlyMinutes > 0 ? (
                    <span className="font-medium text-warning-text">{r.earlyMinutes} min</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3 text-slate-600">{r.pending ? 'Pending calc' : `${r.hours.toFixed(1)} hrs`}</td>
                <td className="px-5 py-3 text-slate-600">{r.pending ? '–' : `${r.overtime.toFixed(1)} hr`}</td>
                <td className="px-5 py-3">
                  <Badge tone={r.status === 'Present' ? 'good' : r.status === 'Late' ? 'warning' : 'critical'}>{r.status}</Badge>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-5 py-8 text-center text-slate-400">
                  No records in this range.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 z-10 border-t-2 border-accent/30 bg-accent/5 text-sm font-bold text-ink">
                <td className="px-5 py-3" colSpan={5}>
                  Totals
                </td>
                <td className="px-5 py-3">{totals.lateMinutes > 0 ? `${(totals.lateMinutes / 60).toFixed(1)} hrs` : '—'}</td>
                <td className="px-5 py-3">{totals.earlyMinutes > 0 ? `${(totals.earlyMinutes / 60).toFixed(1)} hrs` : '—'}</td>
                <td className="px-5 py-3">{totals.workHours.toFixed(1)} hrs</td>
                <td className="px-5 py-3">{totals.overtimeHours.toFixed(1)} hrs</td>
                <td className="px-5 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </AppShell>
  );
}
