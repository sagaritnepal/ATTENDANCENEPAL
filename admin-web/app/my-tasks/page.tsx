'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import Leaderboard from '@/components/Leaderboard';
import TaskHoursChart from '@/components/TaskHoursChart';
import { totalsByTask } from '@/lib/taskHours';
import type { Task, TaskStatus, TaskTimeLog } from '@/lib/types';

const STATUS_TONE: Record<TaskStatus, 'good' | 'warning' | 'critical' | 'info' | 'neutral'> = {
  pending: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'good',
  rejected: 'critical',
};

const EMPTY_TASK_FORM = { title: '', description: '', due_date: '' };

function formatElapsed(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export default function MyTasksPage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<TaskTimeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK_FORM);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskFormError, setTaskFormError] = useState<string | null>(null);

  function reload(empId: string) {
    supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setTasks(data ?? []));
    supabase
      .from('task_time_logs')
      .select('*')
      .eq('employee_id', empId)
      .then(({ data }) => setLogs(data ?? []));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
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

  const runningLog = logs.find(l => l.ended_at === null) ?? null;

  useEffect(() => {
    if (!runningLog) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [runningLog]);

  async function startTimer(taskId: string) {
    setBusyId(taskId);
    setError(null);
    const { error: rpcError } = await supabase.rpc('start_task_timer', { p_task_id: taskId });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    if (employeeId) reload(employeeId);
  }

  async function stopTimer(logId: string) {
    setBusyId(logId);
    setError(null);
    const { error: rpcError } = await supabase.rpc('stop_task_timer', { p_log_id: logId });
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

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    setTaskFormError(null);
    setCreatingTask(true);
    const { error: insertError } = await supabase.from('tasks').insert({
      title: taskForm.title,
      description: taskForm.description || null,
      due_date: taskForm.due_date || null,
      assigned_to: employeeId,
      assigned_by: userId,
      points: 0,
      status: 'pending',
      source: 'self',
    });
    setCreatingTask(false);
    if (insertError) {
      setTaskFormError(insertError.message);
      return;
    }
    setTaskForm(EMPTY_TASK_FORM);
    setShowTaskForm(false);
    reload(employeeId);
  }

  const taskTotals = totalsByTask(logs);
  const taskHours = (taskId: string) => taskTotals.find(t => t.task_id === taskId)?.hours ?? 0;

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
          <div className="mb-5">
            <TaskHoursChart logs={logs} />
          </div>

          {error && <p className="mb-3 text-sm text-critical">{error}</p>}

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Tasks</h2>
            <button
              onClick={() => setShowTaskForm(true)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90"
            >
              + New Task
            </button>
          </div>

          {tasks.length === 0 ? (
            <p className="mb-6 text-center text-sm text-slate-400">No tasks yet.</p>
          ) : (
            <div className="mb-6 space-y-3">
              {tasks.map(t => {
                const isRunningHere = runningLog?.task_id === t.id;
                const hours = taskHours(t.id);
                const active = t.status === 'pending' || t.status === 'in_progress';
                return (
                  <div key={t.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">
                        {t.title}
                        {t.source === 'self' && <span className="ml-2 text-xs font-normal text-slate-400">(self-created)</span>}
                      </span>
                      <Badge tone={STATUS_TONE[t.status]}>{t.status.replace('_', ' ')}</Badge>
                    </div>
                    {t.description && <p className="mb-2 text-xs text-slate-500">{t.description}</p>}
                    <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-400">
                      <span>{t.points} pts</span>
                      {t.due_date && <span>Due {t.due_date}</span>}
                      {hours > 0 && <span>{hours} hrs logged</span>}
                    </div>

                    {t.review_note && (
                      <p className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                        <span className="font-medium">Feedback:</span> {t.review_note}
                      </p>
                    )}

                    {active && (
                      <div className="space-y-2">
                        {isRunningHere ? (
                          <button
                            disabled={busyId === runningLog.id}
                            onClick={() => stopTimer(runningLog.id)}
                            className="w-full rounded-lg bg-critical py-2 text-sm font-semibold text-white disabled:opacity-60"
                          >
                            ⏱ {formatElapsed(runningLog.started_at, now)} · Stop Timer
                          </button>
                        ) : runningLog ? (
                          <p className="text-xs text-slate-400">Timer running on another task.</p>
                        ) : (
                          <button
                            disabled={busyId === t.id}
                            onClick={() => startTimer(t.id)}
                            className="w-full rounded-lg border border-accent py-2 text-sm font-semibold text-accent disabled:opacity-60"
                          >
                            ▶ Start Timer
                          </button>
                        )}

                        <textarea
                          placeholder="What did you do? (optional)"
                          value={noteDraft[t.id] ?? ''}
                          onChange={e => setNoteDraft(d => ({ ...d, [t.id]: e.target.value }))}
                          rows={2}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
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
                );
              })}
            </div>
          )}

          {taskTotals.length > 0 && (
            <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Hours by Task</h2>
              <div className="divide-y divide-slate-100">
                {taskTotals.map(row => {
                  const task = tasks.find(t => t.id === row.task_id);
                  return (
                    <div key={row.task_id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-ink">{task?.title ?? 'Deleted task'}</span>
                      <span className="font-semibold text-ink">{row.hours} hrs</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <Leaderboard highlightEmployeeId={employeeId ?? undefined} />

      {showTaskForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleCreateTask} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-1 text-lg font-semibold text-ink">New Task</h3>
            <p className="mb-4 text-xs text-slate-500">
              Self-created tasks start with 0 points — HR can award points when they review it.
            </p>

            <label className="mb-1 block text-xs font-medium text-slate-600">Title</label>
            <input
              required
              value={taskForm.title}
              onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <label className="mb-1 block text-xs font-medium text-slate-600">Description (optional)</label>
            <textarea
              value={taskForm.description}
              onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))}
              rows={3}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <label className="mb-1 block text-xs font-medium text-slate-600">Due date (optional)</label>
            <input
              type="date"
              value={taskForm.due_date}
              onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            {taskFormError && <p className="mb-3 text-sm text-critical">{taskFormError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTaskForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingTask}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {creatingTask ? 'Creating…' : 'Create task'}
              </button>
            </div>
          </form>
        </div>
      )}
    </EmployeeShell>
  );
}
