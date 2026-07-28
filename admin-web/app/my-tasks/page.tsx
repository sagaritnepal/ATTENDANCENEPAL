'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import Leaderboard from '@/components/Leaderboard';
import type { Task, TaskStatus } from '@/lib/types';

const STATUS_TONE: Record<TaskStatus, 'good' | 'warning' | 'critical' | 'info' | 'neutral'> = {
  pending: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'good',
  rejected: 'critical',
};

export default function MyTasksPage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function reload(empId: string) {
    supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setTasks(data ?? []));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (profile?.employee_id) {
        setEmployeeId(profile.employee_id);
        reload(profile.employee_id);
      }
    });
  }, []);

  async function start(id: string) {
    setBusyId(id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('start_task', { p_task_id: id });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (employeeId) reload(employeeId);
  }

  async function submit(id: string) {
    setBusyId(id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('submit_task', {
      p_task_id: id,
      p_work_notes: noteDraft[id] || null,
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (employeeId) reload(employeeId);
  }

  if (loading) {
    return (
      <EmployeeShell title="My Tasks">
        <p className="text-center text-sm text-slate-400">Loading…</p>
      </EmployeeShell>
    );
  }

  return (
    <EmployeeShell title="My Tasks">
      {!employeeId ? (
        <p className="mt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <>
          {error && <p className="mb-3 text-sm text-critical">{error}</p>}

          {tasks.length === 0 ? (
            <p className="mb-6 text-center text-sm text-slate-400">No tasks assigned yet.</p>
          ) : (
            <div className="mb-6 space-y-3">
              {tasks.map(t => (
                <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">{t.title}</span>
                    <Badge tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
                  </div>
                  {t.description && <p className="mb-2 text-xs text-slate-500">{t.description}</p>}
                  <div className="mb-2 flex gap-4 text-xs text-slate-400">
                    <span>{t.points} pts</span>
                    {t.due_date && <span>Due {t.due_date}</span>}
                  </div>

                  {t.review_note && (
                    <p className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                      <span className="font-medium">Feedback:</span> {t.review_note}
                    </p>
                  )}

                  {t.status === 'pending' && (
                    <button
                      disabled={busyId === t.id}
                      onClick={() => start(t.id)}
                      className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      Start task
                    </button>
                  )}

                  {t.status === 'in_progress' && (
                    <div>
                      <textarea
                        placeholder="What did you do? (optional)"
                        value={noteDraft[t.id] ?? ''}
                        onChange={e => setNoteDraft(d => ({ ...d, [t.id]: e.target.value }))}
                        rows={2}
                        className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                      <button
                        disabled={busyId === t.id}
                        onClick={() => submit(t.id)}
                        className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        Mark as done
                      </button>
                    </div>
                  )}

                  {t.status === 'submitted' && <p className="text-xs text-slate-400">Awaiting review.</p>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Leaderboard highlightEmployeeId={employeeId ?? undefined} />
    </EmployeeShell>
  );
}
