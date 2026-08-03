'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import type { Employee, Shift } from '@/lib/types';
import { resolveShift, formatShiftHours } from '@/lib/shift';

const EMPTY_FORM = { name: '', type: 'fixed' as Shift['type'], start_time: '09:00', end_time: '18:00', grace_minutes: 10, department: '' };

export default function ShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function reload() {
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('employees').select('*').eq('status', 'active').then(({ data }) => setEmployees(data ?? []));
  }
  useEffect(reload, []);

  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);

  const countsByShift = useMemo(() => {
    const counts = new Map<string, number>();
    for (const emp of employees) {
      const shift = resolveShift(emp, shifts);
      counts.set(shift.id, (counts.get(shift.id) ?? 0) + 1);
    }
    return counts;
  }, [employees, shifts]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from('shifts').insert({
      name: form.name,
      type: form.type,
      start_time: form.start_time,
      end_time: form.end_time,
      grace_minutes: form.grace_minutes,
      department: form.department || null,
      employee_id: null,
    });
    setSaving(false);
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this shift?')) return;
    await supabase.from('shifts').delete().eq('id', id);
    reload();
  }

  return (
    <AppShell title="Shift Roster Management">
      <div className="mb-5 flex justify-end">
        <button onClick={() => setShowForm(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90">
          + New Shift
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {templateShifts.map(shift => (
          <div key={shift.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-ink">{shift.name}</h3>
              <Badge tone="info">Active</Badge>
            </div>
            <p className="mb-1 text-sm text-slate-600">🕐 {formatShiftHours(shift)}</p>
            <p className="text-sm text-slate-500">
              👥 {countsByShift.get(shift.id) ?? 0} employees
              {shift.department && <span> · {shift.department}</span>}
            </p>
            <button onClick={() => handleDelete(shift.id)} className="mt-3 text-xs font-medium text-critical hover:underline">
              Delete
            </button>
          </div>
        ))}
        {templateShifts.length === 0 && <p className="text-sm text-slate-400">No shift templates yet — create one to get started.</p>}
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-ink">All Shifts</h2>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap py-2 pr-4 font-medium">Name</th>
              <th className="whitespace-nowrap py-2 pr-4 font-medium">Type</th>
              <th className="whitespace-nowrap py-2 pr-4 font-medium">Hours</th>
              <th className="whitespace-nowrap py-2 pr-4 font-medium">Grace</th>
              <th className="whitespace-nowrap py-2 pr-4 font-medium">Scope</th>
              <th className="whitespace-nowrap py-2 font-medium">Employees</th>
            </tr>
          </thead>
          <tbody>
            {templateShifts.map(s => (
              <tr key={s.id} className="border-b border-slate-100 last:border-0">
                <td className="whitespace-nowrap py-2.5 pr-4 font-medium text-ink">{s.name}</td>
                <td className="whitespace-nowrap py-2.5 pr-4 capitalize text-slate-600">{s.type}</td>
                <td className="whitespace-nowrap py-2.5 pr-4 text-slate-600">{formatShiftHours(s)}</td>
                <td className="whitespace-nowrap py-2.5 pr-4 text-slate-600">{s.grace_minutes} min</td>
                <td className="whitespace-nowrap py-2.5 pr-4 text-slate-600">{s.department ?? 'All'}</td>
                <td className="whitespace-nowrap py-2.5 text-slate-600">{countsByShift.get(s.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleCreate} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">New Shift</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Start</label>
                <input
                  type="time"
                  value={form.start_time}
                  onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">End</label>
                <input
                  type="time"
                  value={form.end_time}
                  onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Grace (min)</label>
                <input
                  type="number"
                  value={form.grace_minutes}
                  onChange={e => setForm(f => ({ ...f, grace_minutes: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Department</label>
                <input
                  value={form.department}
                  onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60">
                {saving ? 'Saving…' : 'Create shift'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
