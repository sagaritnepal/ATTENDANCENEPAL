'use client';

import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import WeeklyRosterGrid from '@/components/WeeklyRosterGrid';
import MonthlyRosterGrid from '@/components/MonthlyRosterGrid';
import type { Employee, Shift } from '@/lib/types';
import { resolveShift, formatShiftHours } from '@/lib/shift';

const EMPTY_FORM = { name: '', type: 'fixed' as Shift['type'], start_time: '09:00', end_time: '18:00', grace_minutes: 10, department: '' };

/** Plain 24-hour HH:MM input — native <input type="time"> renders AM/PM on
 * some Windows/Chrome locale combos regardless of the `lang` attribute. */
function Time24Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hh = '00', mm = '00'] = value.split(':');
  function commit(nextHh: string, nextMm: string) {
    onChange(`${nextHh}:${nextMm}`);
  }
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        max={23}
        value={hh}
        onChange={e => {
          const n = Math.max(0, Math.min(23, Number(e.target.value) || 0));
          commit(String(n).padStart(2, '0'), mm);
        }}
        className="w-16 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm"
      />
      <span className="text-slate-400">:</span>
      <input
        type="number"
        min={0}
        max={59}
        value={mm}
        onChange={e => {
          const n = Math.max(0, Math.min(59, Number(e.target.value) || 0));
          commit(hh, String(n).padStart(2, '0'));
        }}
        className="w-16 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm"
      />
    </div>
  );
}

export default function ShiftsPage() {
  return (
    <Suspense fallback={null}>
      <ShiftsView />
    </Suspense>
  );
}

function ShiftsView() {
  const searchParams = useSearchParams();
  const initialTabParam = searchParams.get('tab');
  const initialTab = initialTabParam === 'roster' ? 'roster' : initialTabParam === 'monthly' ? 'monthly' : 'templates';
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rosterEmployeeIds, setRosterEmployeeIds] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'templates' | 'roster' | 'monthly'>(initialTab);

  function reload() {
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('employees').select('*').eq('status', 'active').then(({ data }) => setEmployees(data ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('employee_id')
      .then(({ data }) => setRosterEmployeeIds(new Set((data ?? []).map(r => r.employee_id))));
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

  // Shift *templates* are edited above; here we only pick which template (if
  // any) applies to this one employee — an upsert into the same
  // employee-scoped shifts row the old Employees-page picker used to write.
  async function applyShiftChange(employeeId: string, templateId: string) {
    if (!templateId) {
      const { error } = await supabase.from('shifts').delete().eq('employee_id', employeeId);
      return error;
    }
    const template = templateShifts.find(t => t.id === templateId);
    if (!template) return null;
    const { error } = await supabase.from('shifts').upsert(
      {
        employee_id: employeeId,
        name: template.name,
        type: template.type,
        start_time: template.start_time,
        end_time: template.end_time,
        grace_minutes: template.grace_minutes,
        department: null,
      },
      { onConflict: 'employee_id' }
    );
    return error;
  }

  async function handleAssignShift(employeeId: string, templateId: string) {
    const error = await applyShiftChange(employeeId, templateId);
    if (error) alert(`Could not update shift: ${error.message}`);
    reload();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      type: form.type,
      start_time: form.start_time,
      end_time: form.end_time,
      grace_minutes: form.grace_minutes,
      department: form.department || null,
    };
    if (editingId) {
      await supabase.from('shifts').update(payload).eq('id', editingId);
    } else {
      await supabase.from('shifts').insert({ ...payload, employee_id: null });
    }
    setSaving(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    reload();
  }

  function handleEdit(shift: Shift) {
    setForm({
      name: shift.name,
      type: shift.type,
      start_time: shift.start_time.slice(0, 5),
      end_time: shift.end_time.slice(0, 5),
      grace_minutes: shift.grace_minutes,
      department: shift.department ?? '',
    });
    setEditingId(shift.id);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this shift?')) return;
    const { error } = await supabase.from('shifts').delete().eq('id', id);
    if (error) alert(`Couldn't delete: ${error.message}`);
    reload();
  }

  return (
    <AppShell title="Shift Roster Management">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
          <button
            onClick={() => setTab('templates')}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              tab === 'templates' ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            Shift Templates
          </button>
          <button
            onClick={() => setTab('roster')}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              tab === 'roster' ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            Weekly Roster
          </button>
          <button
            onClick={() => setTab('monthly')}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              tab === 'monthly' ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            Monthly Roster
          </button>
        </div>
        {tab === 'templates' && (
          <button
            onClick={() => {
              setForm(EMPTY_FORM);
              setEditingId(null);
              setShowForm(true);
            }}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
          >
            + New Shift
          </button>
        )}
      </div>

      {tab === 'roster' ? (
        <WeeklyRosterGrid />
      ) : tab === 'monthly' ? (
        <MonthlyRosterGrid />
      ) : (
        <>
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
            <div className="mt-3 flex gap-3">
              <button onClick={() => handleEdit(shift)} className="text-xs font-medium text-accent hover:underline">
                Edit
              </button>
              <button onClick={() => handleDelete(shift.id)} className="text-xs font-medium text-critical hover:underline">
                Delete
              </button>
            </div>
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

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-1 text-base font-semibold text-ink">Employee Shift Assignments</h2>
        <p className="mb-4 text-sm text-slate-500">
          Assign one employee a fixed shift other than their department default. Employees filled in on the Weekly
          Roster instead show <span className="font-medium text-accent">Custom</span> here — their shift varies day
          to day, so it isn't a single pick.
        </p>
        <div className="divide-y divide-slate-100">
          {employees.map(emp => {
            const shift = resolveShift(emp, shifts);
            const hasOwnShift = shifts.some(s => s.employee_id === emp.id);
            const deptDefaultShift = resolveShift(emp, shifts.filter(s => s.employee_id !== emp.id));
            const onRoster = rosterEmployeeIds.has(emp.id);
            return (
              <div key={emp.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-sm font-medium text-ink">{emp.name}</span>
                {onRoster ? (
                  <button
                    onClick={() => setTab('roster')}
                    className="shrink-0 rounded-lg border border-accent/20 bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10"
                  >
                    Custom — Weekly Roster
                  </button>
                ) : (
                  <div className="w-48 shrink-0">
                    <ShiftPicker
                      value={hasOwnShift ? templateShifts.find(t => t.name === shift.name && t.start_time === shift.start_time && t.end_time === shift.end_time)?.id ?? '' : ''}
                      onChange={id => handleAssignShift(emp.id, id)}
                      options={[
                        { id: '', label: 'Default', hours: formatShiftHours(deptDefaultShift) },
                        ...templateShifts.map(t => ({ id: t.id, label: t.name, hours: formatShiftHours(t) })),
                      ]}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {employees.length === 0 && <p className="py-4 text-sm text-slate-400">No active employees.</p>}
        </div>
      </div>
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleSave} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">{editingId ? 'Edit Shift' : 'New Shift'}</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Start (24h)</label>
                <Time24Input value={form.start_time} onChange={v => setForm(f => ({ ...f, start_time: v }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">End (24h)</label>
                <Time24Input value={form.end_time} onChange={v => setForm(f => ({ ...f, end_time: v }))} />
              </div>
            </div>
            <div className="mb-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">Grace (min)</label>
              <input
                type="number"
                value={form.grace_minutes}
                onChange={e => setForm(f => ({ ...f, grace_minutes: Number(e.target.value) }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingId(null);
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button type="submit" disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60">
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create shift'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}

type ShiftOption = { id: string; label: string; hours: string };

// A native <select> can only show one line of plain text for the current
// value, so it can't surface the shift's time range without truncating the
// name. This renders the trigger and each option as two lines (name, then
// time) so the assigned hours are visible at a glance.
function ShiftPicker({
  options,
  value,
  onChange,
}: {
  options: ShiftOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.id === value) ?? options[0];

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onBlur={e => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
      className="relative"
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full flex-col items-center gap-0.5 rounded-lg border border-accent/20 bg-accent/5 px-2 py-1.5 text-center transition-colors hover:border-accent/40 hover:bg-accent/10"
      >
        <span className="max-w-full truncate text-xs font-semibold text-ink">{selected?.label}</span>
        <span className="flex max-w-full items-center gap-1 truncate text-[10px] font-medium text-accent">
          <ClockIcon className="h-3 w-3 shrink-0" />
          {selected?.hours}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-56 w-48 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o.id);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-accent/5 ${
                o.id === value ? 'bg-accent/10' : ''
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-ink">{o.label}</span>
                <span className="block truncate text-[10px] text-slate-400">{o.hours}</span>
              </span>
              {o.id === value && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </svg>
  );
}
