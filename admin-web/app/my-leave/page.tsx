'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import type { LeaveRequest, LeaveType } from '@/lib/types';

const LEAVE_TYPES: LeaveType[] = ['casual', 'sick', 'annual', 'unpaid'];
const EMPTY_FORM = { leave_type: 'casual' as LeaveType, start_date: '', end_date: '', reason: '' };

export default function MyLeavePage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload(empId: string) {
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests(data ?? []));
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    setError(null);
    setSubmitting(true);
    const { error: insertError } = await supabase.from('leave_requests').insert({
      employee_id: employeeId,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason || null,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setForm(EMPTY_FORM);
    reload(employeeId);
  }

  function statusTone(status: string) {
    if (status === 'approved') return 'good' as const;
    if (status === 'rejected') return 'critical' as const;
    return 'warning' as const;
  }

  if (loading) {
    return (
      <EmployeeShell title="Leave">
        <p className="text-center text-sm text-slate-400">Loading…</p>
      </EmployeeShell>
    );
  }

  return (
    <EmployeeShell title="Leave">
      <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <label className="mb-1 block text-xs font-medium text-slate-600">Type</label>
        <div className="mb-3 flex flex-wrap gap-2">
          {LEAVE_TYPES.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setForm(f => ({ ...f, leave_type: t }))}
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize ${
                form.leave_type === t ? 'bg-accent text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs font-medium text-slate-600">Start date</label>
        <input
          type="date"
          required
          value={form.start_date}
          onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">End date</label>
        <input
          type="date"
          required
          value={form.end_date}
          onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Reason (optional)</label>
        <textarea
          value={form.reason}
          onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          rows={2}
        />
        {error && <p className="mb-3 text-sm text-critical">{error}</p>}
        <button
          type="submit"
          disabled={submitting || !employeeId}
          className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
        {!employeeId && (
          <p className="mt-2 text-xs text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
        )}
      </form>

      <h2 className="mb-3 text-sm font-semibold text-ink">My requests</h2>
      {requests.length === 0 ? (
        <p className="text-center text-sm text-slate-400">No leave requests yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {requests.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <div className="text-sm font-medium capitalize text-ink">
                  {r.leave_type} · {r.start_date} → {r.end_date}
                </div>
                {r.reason && <div className="text-xs text-slate-400">{r.reason}</div>}
              </div>
              <Badge tone={statusTone(r.status)}>{r.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </EmployeeShell>
  );
}
