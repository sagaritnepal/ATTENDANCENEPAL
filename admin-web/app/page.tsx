'use client';

import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import StatCard from '@/components/StatCard';
import Badge from '@/components/Badge';
import type { AttendanceLog, Device, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';
import { dateKey, isLate, last7Days, presentEmployeeIds, WEEKDAY_LABEL } from '@/lib/metrics';

const DEPT_COLORS: Record<string, string> = {
  Engineering: '#0d9488',
  Operations: '#2563eb',
  Marketing: '#f97316',
  Sales: '#a855f7',
  Support: '#ec4899',
};
const OTHER_COLOR = '#94a3b8';

type FeedItem = AttendanceLog & { employee_name: string };

export default function DashboardPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [onLeave, setOnLeave] = useState<LeaveRequest[]>([]);
  const [todaySummaries, setTodaySummaries] = useState<PayrollSummary[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);

  useEffect(() => {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);

    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from('leave_requests')
      .select('*')
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today)
      .then(({ data }) => setOnLeave(data ?? []));
    supabase
      .from('payroll_summaries')
      .select('*')
      .eq('work_date', today)
      .then(({ data }) => setTodaySummaries(data ?? []));
    supabase
      .from('attendance_logs')
      .select('*')
      .gte('punch_time', since.toISOString())
      .order('punch_time', { ascending: false })
      .then(({ data }) => setLogs(data ?? []));

    const channel = supabase
      .channel('dashboard-live-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_logs' }, payload => {
        const log = payload.new as AttendanceLog;
        setLogs(prev => [log, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (employees.length === 0) return;
    const byId = new Map(employees.map(e => [e.id, e.name]));
    setFeed(
      logs.slice(0, 8).map(log => ({ ...log, employee_name: byId.get(log.employee_id) ?? 'Unknown' }))
    );
  }, [logs, employees]);

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'active'), [employees]);
  const today = dateKey(new Date().toISOString());
  const todayLogs = useMemo(() => logs.filter(l => dateKey(l.punch_time) === today), [logs, today]);
  const presentIds = useMemo(() => presentEmployeeIds(logs, today), [logs, today]);

  const lateCount = useMemo(() => {
    let count = 0;
    for (const emp of activeEmployees) {
      const empLogs = todayLogs.filter(l => l.employee_id === emp.id);
      if (empLogs.length && isLate(emp, shifts, empLogs)) count++;
    }
    return count;
  }, [activeEmployees, todayLogs, shifts]);

  const onLeaveIds = useMemo(() => new Set(onLeave.map(l => l.employee_id)), [onLeave]);
  const absentCount = Math.max(
    0,
    activeEmployees.length - presentIds.size - Array.from(onLeaveIds).filter(id => !presentIds.has(id)).length
  );
  const attendancePct = activeEmployees.length ? Math.round((presentIds.size / activeEmployees.length) * 100) : 0;

  const todayWorkHours = useMemo(() => todaySummaries.reduce((sum, s) => sum + Number(s.total_hours), 0), [todaySummaries]);
  const todayOvertimeHours = useMemo(() => todaySummaries.reduce((sum, s) => sum + Number(s.overtime_hours), 0), [todaySummaries]);

  const trend = useMemo(() => {
    return last7Days().map(day => {
      const count = presentEmployeeIds(logs, day).size;
      const weekday = WEEKDAY_LABEL[new Date(day + 'T00:00:00Z').getUTCDay()];
      return { day: weekday, present: count };
    });
  }, [logs]);

  const deptBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const emp of activeEmployees) {
      const key = emp.department && DEPT_COLORS[emp.department] ? emp.department : emp.department ? 'Other' : 'Unassigned';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, value]) => ({
      name,
      value,
      color: DEPT_COLORS[name] ?? OTHER_COLOR,
    }));
  }, [activeEmployees]);

  return (
    <AppShell title="Dashboard">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        <StatCard label="Total Employees" value={String(activeEmployees.length)} hint="Active rosters" />
        <StatCard label="Present Today" value={String(presentIds.size)} hint={`${attendancePct}% attendance`} />
        <StatCard label="Late Arrivals" value={String(lateCount)} hint="Past grace period" />
        <StatCard label="On Leave" value={String(onLeaveIds.size)} hint="Approved today" />
        <StatCard label="Absent Today" value={String(absentCount)} hint="No punch, not on leave" />
        <StatCard label="Total Work Hours" value={todayWorkHours.toFixed(1)} hint="Today, all staff" />
        <StatCard className="col-span-2 sm:col-span-1" label="Overtime" value={`${todayOvertimeHours.toFixed(1)} hrs`} hint="Today, all staff" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 lg:col-span-2">
          <h2 className="mb-4 text-base font-semibold text-ink">Weekly Attendance Trend</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                formatter={(v: number) => [`${v} present`, '']}
              />
              <Line
                type="monotone"
                dataKey="present"
                name="Present"
                stroke="#0d9488"
                strokeWidth={2}
                dot={{ r: 4, fill: '#0d9488' }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Live Biometric Feed</h2>
            <span className="flex items-center gap-1.5 text-xs font-medium text-good">
              <span className="h-1.5 w-1.5 rounded-full bg-good" />
              Realtime
            </span>
          </div>
          <ul className="space-y-3">
            {feed.length === 0 && <li className="text-sm text-slate-400">No punches yet.</li>}
            {feed.map(item => (
              <li key={item.id} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium text-ink">{item.employee_name}</div>
                  <div className="text-xs text-slate-500">{item.method}</div>
                </div>
                <div className="text-right">
                  <Badge tone={item.punch_type === '0' ? 'good' : 'info'}>
                    {item.punch_type === '0' ? 'Check-in' : 'Check-out'}
                  </Badge>
                  <div className="mt-1 text-xs text-slate-500">
                    {new Date(item.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-ink">Department Breakdown</h2>
          {deptBreakdown.length === 0 ? (
            <p className="text-sm text-slate-400">No employees yet.</p>
          ) : (
            // A right-side vertical legend fights the pie for width on a
            // narrow phone (single-column below lg) — bottom-horizontal
            // works at every width instead of needing a JS breakpoint check.
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={deptBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                  {deptBreakdown.map(d => (
                    <Cell key={d.name} fill={d.color} stroke="#fff" strokeWidth={2} />
                  ))}
                </Pie>
                <Legend
                  layout="horizontal"
                  verticalAlign="bottom"
                  align="center"
                  iconType="circle"
                  wrapperStyle={{ paddingTop: 12 }}
                  formatter={(value: string) => <span className="text-sm text-slate-600">{value}</span>}
                />
                <Tooltip formatter={(v: number, n: string) => [`${v} staff`, n]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-ink">Device Sync Activity</h2>
          <ul className="space-y-3">
            {devices.length === 0 && <li className="text-sm text-slate-400">No devices registered.</li>}
            {devices.map(d => (
              <li key={d.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5">
                <div>
                  <div className="text-sm font-medium text-ink">{d.name}</div>
                  <div className="text-xs text-slate-500">
                    {d.ip_address} · Sync: {d.last_sync ? new Date(d.last_sync).toLocaleTimeString() : 'never'}
                  </div>
                </div>
                <Badge tone={d.status === 'online' ? 'good' : 'critical'}>{d.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppShell>
  );
}
