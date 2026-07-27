'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
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
  overtime: number;
};

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function AttendancePage() {
  const [from, setFrom] = useState(isoDaysAgo(6));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [status, setStatus] = useState<'All' | 'Present' | 'Late' | 'Absent'>('All');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    supabase.from('employees').select('*').eq('status', 'active').then(({ data }) => setEmployees(data ?? []));
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
      for (const emp of employees) {
        const summary = summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        if (summary) {
          const firstLog = logs.find(
            l => l.employee_id === emp.id && l.punch_time.slice(0, 10) === day
          );
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            employeeName: emp.name,
            device: deviceName(firstLog?.device_id ?? null),
            checkIn: summary.check_in,
            checkOut: summary.check_out,
            hours: summary.total_hours,
            status: summary.is_late ? 'Late' : 'Present',
            overtime: summary.overtime_hours,
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
            overtime: 0,
          });
        }
      }
    }
    return out.filter(r => status === 'All' || r.status === status).sort((a, b) => b.date.localeCompare(a.date));
  }, [employees, summaries, logs, devices, from, to, status]);

  function exportCsv() {
    const header = ['Date', 'Employee', 'Device', 'Check-In', 'Check-Out', 'Hours Worked', 'Status', 'Overtime'];
    const lines = rows.map(r =>
      [
        r.date,
        r.employeeName,
        r.device,
        r.checkIn ? new Date(r.checkIn).toLocaleTimeString() : '',
        r.checkOut ? new Date(r.checkOut).toLocaleTimeString() : '',
        r.hours.toFixed(1),
        r.status,
        r.overtime.toFixed(1),
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
    <AppShell title="Biometric Attendance Logs">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <span className="text-slate-400">–</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
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
        </div>
        <button onClick={exportCsv} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          ⭳ Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="px-5 py-3 font-medium">Device</th>
              <th className="px-5 py-3 font-medium">Check-In</th>
              <th className="px-5 py-3 font-medium">Check-Out</th>
              <th className="px-5 py-3 font-medium">Hours Worked</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Overtime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 text-slate-600">{r.date}</td>
                <td className="px-5 py-3 font-medium text-ink">{r.employeeName}</td>
                <td className="px-5 py-3 text-slate-600">{r.device}</td>
                <td className="px-5 py-3 text-slate-600">{r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–:–'}</td>
                <td className="px-5 py-3 text-slate-600">{r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–:–'}</td>
                <td className="px-5 py-3 text-slate-600">{r.hours.toFixed(1)} hrs</td>
                <td className="px-5 py-3">
                  <Badge tone={r.status === 'Present' ? 'good' : r.status === 'Late' ? 'warning' : 'critical'}>{r.status}</Badge>
                </td>
                <td className="px-5 py-3 text-slate-600">{r.overtime.toFixed(1)} hr</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                  No records in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
