'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import Leaderboard from '@/components/Leaderboard';
import type { Employee, Task, TaskStatus } from '@/lib/types';

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

  function reload() {
    supabase.from('tasks').select('*').order('created_at', { ascending: false }).then(({ data }) => setTasks(data ?? []));
    supabase.from('employees').select('*').eq('status', 'active').order('name').then(({ data }) => setEmployees(data ?? []));
  }
  useEffect(reload, []);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';

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

  async function review(id: string, status: 'approved' | 'rejected') {
    setBusyId(id);
    const { data } = await supabase.auth.getUser();
    await supabase
      .from('tasks')
      .update({
        status,
        review_note: noteDraft[id] || null,
        reviewed_by: data.user?.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id);
    setBusyId(null);
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
                    <div className="font-medium text-ink">{t.title}</div>
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
                        <input
                          placeholder="Optional review note"
                          value={noteDraft[t.id] ?? ''}
                          onChange={e => setNoteDraft(d => ({ ...d, [t.id]: e.target.value }))}
                          className="w-48 rounded-md border border-slate-200 px-2 py-1 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={busyId === t.id}
                            onClick={() => review(t.id, 'approved')}
                            className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            disabled={busyId === t.id}
                            onClick={() => review(t.id, 'rejected')}
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
                <input
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
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
