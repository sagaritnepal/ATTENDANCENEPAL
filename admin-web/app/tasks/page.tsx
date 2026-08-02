'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import Leaderboard from '@/components/Leaderboard';
import TaskHoursChart from '@/components/TaskHoursChart';
import { totalsByTask } from '@/lib/taskHours';
import type { Employee, PointRedemption, Task, TaskStatus, TaskTimeLog } from '@/lib/types';

const EMPTY_FORM = { employee_id: '', title: '', description: '', points: 10, due_date: '' };

const STATUS_TONE: Record<TaskStatus, 'good' | 'warning' | 'critical' | 'info' | 'neutral'> = {
  pending: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'good',
  rejected: 'critical',
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<TaskStatus | 'All'>('submitted');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [pointsDraft, setPointsDraft] = useState<Record<string, number>>({});

  const [hoursEmployeeId, setHoursEmployeeId] = useState('');
  const [hoursLogs, setHoursLogs] = useState<TaskTimeLog[]>([]);

  const [redemptions, setRedemptions] = useState<PointRedemption[]>([]);
  const [redemptionFilter, setRedemptionFilter] = useState<'pending' | 'approved' | 'rejected' | 'All'>('pending');
  const [busyRedemptionId, setBusyRedemptionId] = useState<string | null>(null);

  function reload() {
    supabase.from('tasks').select('*').order('created_at', { ascending: false }).then(({ data }) => setTasks(data ?? []));
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => {
        setEmployees(data ?? []);
        if (data && data.length > 0) setHoursEmployeeId(prev => prev || data[0].id);
      });
    supabase
      .from('point_redemptions')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRedemptions(data ?? []));
  }
  useEffect(reload, []);

  useEffect(() => {
    if (!hoursEmployeeId) return;
    supabase
      .from('task_time_logs')
      .select('*')
      .eq('employee_id', hoursEmployeeId)
      .then(({ data }) => setHoursLogs(data ?? []));
  }, [hoursEmployeeId]);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';
  const hoursTaskTotals = useMemo(() => totalsByTask(hoursLogs), [hoursLogs]);
  const employeeTasks = useMemo(() => tasks.filter(t => t.assigned_to === hoursEmployeeId), [tasks, hoursEmployeeId]);

  const filtered = useMemo(() => (filter === 'All' ? tasks : tasks.filter(t => t.status === filter)), [tasks, filter]);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    const { error } = await supabase.from('tasks').insert({
      assigned_to: form.employee_id,
      assigned_by: data.user?.id,
      title: form.title,
      description: form.description || null,
      points: form.points,
      due_date: form.due_date || null,
    });
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  async function review(task: Task, status: 'approved' | 'rejected') {
    setBusyId(task.id);
    const { data } = await supabase.auth.getUser();
    await supabase
      .from('tasks')
      .update({
        status,
        points: status === 'approved' ? pointsDraft[task.id] ?? task.points : task.points,
        review_note: noteDraft[task.id] || null,
        reviewed_by: data.user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', task.id);
    setBusyId(null);
    reload();
  }

  const filteredRedemptions = useMemo(
    () => (redemptionFilter === 'All' ? redemptions : redemptions.filter(r => r.status === redemptionFilter)),
    [redemptions, redemptionFilter]
  );

  async function reviewRedemption(id: string, status: 'approved' | 'rejected') {
    setBusyRedemptionId(id);
    const { data } = await supabase.auth.getUser();
    await supabase
      .from('point_redemptions')
      .update({ status, reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', id);
    setBusyRedemptionId(null);
    reload();
  }

  return (
    <AppShell title="Tasks & Rewards">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(['pending', 'in_progress', 'submitted', 'approved', 'rejected', 'All'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
                filter === f ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
        >
          + Assign Task
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Employee</th>
                <th className="px-5 py-3 font-medium">Task</th>
                <th className="px-5 py-3 font-medium">Points</th>
                <th className="px-5 py-3 font-medium">Due</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="px-5 py-3 font-medium text-ink">{employeeName(t.assigned_to)}</td>
                  <td className="px-5 py-3 text-slate-600">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{t.title}</span>
                      {t.source === 'self' && <Badge tone="info">Self-assigned</Badge>}
                    </div>
                    {t.description && <div className="text-xs text-slate-400">{t.description}</div>}
                    {t.work_notes && (
                      <div className="mt-1 text-xs text-slate-500">
                        <span className="font-medium">Employee note:</span> {t.work_notes}
                      </div>
                    )}
                    {t.review_note && (
                      <div className="mt-1 text-xs text-slate-500">
                        <span className="font-medium">Review note:</span> {t.review_note}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{t.points}</td>
                  <td className="px-5 py-3 text-slate-600">{t.due_date ?? '—'}</td>
                  <td className="px-5 py-3">
                    <Badge tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-5 py-3">
                    {t.status === 'submitted' ? (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-slate-500">
                          Points to award
                          <input
                            type="number"
                            min={0}
                            value={pointsDraft[t.id] ?? t.points}
                            onChange={e => setPointsDraft(d => ({ ...d, [t.id]: Number(e.target.value) }))}
                            className="mt-0.5 w-24 rounded-md border border-slate-200 px-2 py-1 text-xs"
                          />
                        </label>
                        <input
                          placeholder="Optional review note"
                          value={noteDraft[t.id] ?? ''}
                          onChange={e => setNoteDraft(d => ({ ...d, [t.id]: e.target.value }))}
                          className="w-48 rounded-md border border-slate-200 px-2 py-1 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={busyId === t.id}
                            onClick={() => review(t, 'approved')}
                            className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            disabled={busyId === t.id}
                            onClick={() => review(t, 'rejected')}
                            className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">
                        {t.status === 'pending' || t.status === 'in_progress' ? 'Awaiting employee' : 'Reviewed'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                    No {filter !== 'All' ? filter.replace('_', ' ') : ''} tasks.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <Leaderboard />
      </div>

      <div className="mt-6">
        <div className="mb-3 max-w-xs">
          <label className="mb-1 block text-xs font-medium text-slate-600">Hours worked by</label>
          <select
            value={hoursEmployeeId}
            onChange={e => setHoursEmployeeId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
          <TaskHoursChart logs={hoursLogs} tasks={employeeTasks} />

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Hours by Task</h2>
            {hoursTaskTotals.length === 0 ? (
              <p className="text-sm text-slate-400">No time logged yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {hoursTaskTotals.map(row => {
                  const task = employeeTasks.find(t => t.id === row.task_id);
                  return (
                    <div key={row.task_id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-ink">{task?.title ?? 'Deleted task'}</span>
                      <span className="font-semibold text-ink">{row.hours} hrs</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Point Redemptions</h2>
        <div className="mb-4 flex flex-wrap gap-2">
          {(['pending', 'approved', 'rejected', 'All'] as const).map(f => (
            <button
              key={f}
              onClick={() => setRedemptionFilter(f)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium capitalize ${
                redemptionFilter === f ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        {filteredRedemptions.length === 0 ? (
          <p className="text-sm text-slate-400">No {redemptionFilter !== 'All' ? redemptionFilter : ''} redemption requests.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRedemptions.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink">
                    {employeeName(r.employee_id)} · {r.points_requested} pts
                  </div>
                  {r.note && <div className="text-xs text-slate-400">{r.note}</div>}
                </div>
                {r.status === 'pending' ? (
                  <div className="flex gap-2">
                    <button
                      disabled={busyRedemptionId === r.id}
                      onClick={() => reviewRedemption(r.id, 'approved')}
                      className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busyRedemptionId === r.id}
                      onClick={() => reviewRedemption(r.id, 'rejected')}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <Badge tone={r.status === 'approved' ? 'good' : 'critical'}>{r.status}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAssign} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Assign Task</h3>

            <label className="mb-1 block text-xs font-medium text-slate-600">Employee</label>
            <select
              required
              value={form.employee_id}
              onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="" disabled>
                Select employee…
              </option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
            <input
              required
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <label className="mb-1 block text-xs font-medium text-slate-600">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Points</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={form.points}
                  onChange={e => setForm(f => ({ ...f, points: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Due date (optional)</label>
                <DueDatePicker value={form.due_date} onChange={v => setForm(f => ({ ...f, due_date: v }))} />
              </div>
            </div>

            {formError && <p className="mb-3 text-sm text-critical">{formError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {saving ? 'Assigning…' : 'Assign task'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}

// A click-to-pick month grid instead of the native <input type="date">
// picker, with today's date always visible at the bottom so it's easy to
// judge how far out the deadline is.
function DueDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  function openPicker() {
    const base = value ? new Date(`${value}T00:00:00`) : today;
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setOpen(true);
  }

  function isoFor(day: number) {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function selectDay(day: number) {
    onChange(isoFor(day));
    setOpen(false);
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(y => y - 1);
    } else {
      setViewMonth(m => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(y => y + 1);
    } else {
      setViewMonth(m => m + 1);
    }
  }

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const monthLabel = firstOfMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const displayValue = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const todayLabel = today.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

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
        onClick={() => (open ? setOpen(false) : openPicker())}
        className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-accent/40"
      >
        <span className={displayValue ? 'text-ink' : 'text-slate-400'}>{displayValue || 'Select due date'}</span>
        <MiniCalendarIcon className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={prevMonth} className="rounded p-1 text-slate-500 hover:bg-slate-100">
              ‹
            </button>
            <span className="text-sm font-semibold text-ink">{monthLabel}</span>
            <button type="button" onClick={nextMonth} className="rounded p-1 text-slate-500 hover:bg-slate-100">
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <span key={i} />;
              const iso = isoFor(day);
              const isToday = iso === todayIso;
              const isSelected = iso === value;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectDay(day)}
                  className={`h-7 w-7 rounded-full text-xs ${
                    isSelected
                      ? 'bg-accent font-semibold text-white'
                      : isToday
                        ? 'bg-accent/10 font-semibold text-accent'
                        : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="text-[11px] text-slate-400">Today: {todayLabel}</span>
            <button
              type="button"
              onClick={() => {
                onChange(todayIso);
                setOpen(false);
              }}
              className="text-[11px] font-medium text-accent hover:underline"
            >
              Select today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniCalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
