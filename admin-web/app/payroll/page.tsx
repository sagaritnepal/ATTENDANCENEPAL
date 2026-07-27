'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import type { Employee, PayrollSummary } from '@/lib/types';

function monthBounds(offset: number) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const start = d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start, end, label };
}

export default function PayrollPage() {
  const [offset, setOffset] = useState(0);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [recalculating, setRecalculating] = useState(false);

  const { start, end, label } = monthBounds(offset);

  function reload() {
    supabase.from('payroll_summaries').select('*').gte('work_date', start).lte('work_date', end).then(({ data }) => setSummaries(data ?? []));
    supabase.from('employees').select('*').eq('status', 'active').then(({ data }) => setEmployees(data ?? []));
  }

  useEffect(reload, [start, end]);

  async function recalculateMonth() {
    setRecalculating(true);
    const days: string[] = [];
    const cur = new Date(start + 'T00:00:00Z');
    const endDate = new Date(end + 'T00:00:00Z');
    const today = new Date().toISOString().slice(0, 10);
    while (cur.toISOString().slice(0, 10) <= end && cur <= endDate) {
      const day = cur.toISOString().slice(0, 10);
      if (day <= today) days.push(day);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    for (const day of days) {
      await supabase.rpc('compute_payroll_summaries', { p_work_date: day });
    }
    setRecalculating(false);
    reload();
  }

  const totals = useMemo(() => {
    const totalHours = summaries.reduce((s, r) => s + Number(r.total_hours), 0);
    const overtimeHours = summaries.reduce((s, r) => s + Number(r.overtime_hours), 0);
    const workedDays = new Set(summaries.map(r => `${r.employee_id}-${r.work_date}`)).size;
    const daysInRange = (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1;
    const possibleDays = employees.length * daysInRange;
    const attendancePct = possibleDays ? Math.round((workedDays / possibleDays) * 1000) / 10 : 0;
    return { totalHours, overtimeHours, attendancePct };
  }, [summaries, employees, start, end]);

  const byEmployee = useMemo(() => {
    const map = new Map<string, { name: string; days: number; hours: number; overtime: number; lateDays: number }>();
    for (const emp of employees) map.set(emp.id, { name: emp.name, days: 0, hours: 0, overtime: 0, lateDays: 0 });
    for (const s of summaries) {
      const row = map.get(s.employee_id);
      if (!row) continue;
      row.days += 1;
      row.hours += Number(s.total_hours);
      row.overtime += Number(s.overtime_hours);
      if (s.is_late) row.lateDays += 1;
    }
    return Array.from(map.values());
  }, [summaries, employees]);

  return (
    <AppShell title="Attendance-based Payroll Controller">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setOffset(o => o - 1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">←</button>
          <span className="font-semibold text-ink">{label}</span>
          <button onClick={() => setOffset(o => o + 1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">→</button>
        </div>
        <button
          onClick={recalculateMonth}
          disabled={recalculating}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
        >
          {recalculating ? 'Recalculating…' : 'Recalculate month'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="text-sm text-slate-500">Total Payable Hours</span>
          <div className="mt-2 text-3xl font-bold text-ink">{totals.totalHours.toFixed(1)} hrs</div>
          <div className="mt-1 text-xs text-slate-500">Across {employees.length} staff</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="text-sm text-slate-500">Overtime Tracked</span>
          <div className="mt-2 text-3xl font-bold text-ink">{totals.overtimeHours.toFixed(1)} hrs</div>
          <div className="mt-1 text-xs text-slate-500">This period</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="text-sm text-slate-500">Average Attendance</span>
          <div className="mt-2 text-3xl font-bold text-ink">{totals.attendancePct}%</div>
          <div className="mt-1 text-xs text-slate-500">Worked days vs possible</div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-ink">Roster hours breakdown</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 font-medium">Employee</th>
              <th className="py-2 font-medium">Worked Days</th>
              <th className="py-2 font-medium">Total Hours</th>
              <th className="py-2 font-medium">Overtime</th>
              <th className="py-2 font-medium">Late Days</th>
            </tr>
          </thead>
          <tbody>
            {byEmployee.map(row => (
              <tr key={row.name} className="border-b border-slate-100 last:border-0">
                <td className="py-2.5 font-medium text-ink">{row.name}</td>
                <td className="py-2.5 text-slate-600">{row.days}</td>
                <td className="py-2.5 text-slate-600">{row.hours.toFixed(1)} hrs</td>
                <td className="py-2.5 text-slate-600">{row.overtime.toFixed(1)} hrs</td>
                <td className="py-2.5 text-slate-600">{row.lateDays}</td>
              </tr>
            ))}
            {byEmployee.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400">No active employees.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
