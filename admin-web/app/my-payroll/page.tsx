'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Employee, PayrollSummary } from '@/lib/types';

function monthBounds(offset: number) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const start = d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start, end, label };
}

export default function MyPayrollPage() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);

  const { start, end, label } = monthBounds(offset);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (!profile?.employee_id) return;
      setEmployeeId(profile.employee_id);
      const { data: emp } = await supabase.from('employees').select('*').eq('id', profile.employee_id).single();
      setEmployee(emp ?? null);
    });
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    supabase
      .from('payroll_summaries')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('work_date', start)
      .lte('work_date', end)
      .order('work_date', { ascending: false })
      .then(({ data }) => setSummaries(data ?? []));
  }, [employeeId, start, end]);

  const totals = useMemo(() => {
    const totalHours = summaries.reduce((s, r) => s + Number(r.total_hours), 0);
    const overtimeHours = summaries.reduce((s, r) => s + Number(r.overtime_hours), 0);
    const lateDays = summaries.filter(r => r.is_late).length;
    return { totalHours, overtimeHours, presentDays: summaries.length, lateDays };
  }, [summaries]);

  return (
    <EmployeeShell title="Payroll">
      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employeeId ? (
        <p className="mt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <>
          {employee?.salary != null && (
            <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Current Salary</div>
              <div className="text-2xl font-bold text-ink">{employee.salary.toLocaleString()}</div>
            </div>
          )}

          <div className="mb-4 flex items-center justify-between">
            <button onClick={() => setOffset(o => o - 1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
              ←
            </button>
            <span className="text-sm font-semibold text-ink">{label}</span>
            <button onClick={() => setOffset(o => o + 1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
              →
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-good-bg p-4">
              <div className="text-xs font-medium text-good-text">Total Hours</div>
              <div className="mt-1 text-xl font-bold text-ink">{totals.totalHours.toFixed(1)} hrs</div>
            </div>
            <div className="rounded-xl bg-info-bg p-4">
              <div className="text-xs font-medium text-info-text">Overtime</div>
              <div className="mt-1 text-xl font-bold text-ink">{totals.overtimeHours.toFixed(1)} hrs</div>
            </div>
            <div className="rounded-xl bg-good-bg p-4">
              <div className="text-xs font-medium text-good-text">Present Days</div>
              <div className="mt-1 text-xl font-bold text-ink">{totals.presentDays}</div>
            </div>
            <div className="rounded-xl bg-warning-bg p-4">
              <div className="text-xs font-medium text-warning-text">Late Days</div>
              <div className="mt-1 text-xl font-bold text-ink">{totals.lateDays}</div>
            </div>
          </div>

          <h2 className="mb-3 mt-6 text-sm font-semibold text-ink">Daily Breakdown</h2>
          {summaries.length === 0 ? (
            <p className="mt-2 text-center text-sm text-slate-400">No payroll records for this month yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {summaries.map(row => (
                <div key={row.id} className="px-4 py-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-ink">{formatAdDate(row.work_date, system)}</span>
                    <span className="text-sm font-semibold text-ink">{Number(row.total_hours).toFixed(1)} hrs</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {row.is_late && <Badge tone="warning">Late</Badge>}
                    {row.is_early_departure && <Badge tone="critical">Early Out</Badge>}
                    {Number(row.overtime_hours) > 0 && <Badge tone="info">OT {Number(row.overtime_hours).toFixed(1)}h</Badge>}
                    {!row.is_late && !row.is_early_departure && Number(row.overtime_hours) === 0 && <Badge tone="good">On Time</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </EmployeeShell>
  );
}
