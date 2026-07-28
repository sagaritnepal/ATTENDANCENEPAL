'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import type { CorrectionRequest } from '@/lib/types';

const EMPTY_FORM = { work_date: '', check_in_time: '', check_out_time: '', reason: '' };

function toTimestamp(date: string, time: string) {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MyCorrectionsPage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload(empId: string) {
    supabase
      .from('attendance_correction_requests')
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
    const checkIn = toTimestamp(form.work_date, form.check_in_time);
    const checkOut = toTimestamp(form.work_date, form.check_out_time);
    if (!form.work_date || (!checkIn && !checkOut)) {
      setError('Pick a date and at least one of check-in or check-out time.');
      return;
    }
    setSubmitting(true);
    const { error: insertError } = await supabase.from('attendance_correction_requests').insert({
      employee_id: employeeId,
      work_date: form.work_date,
      requested_check_in: checkIn,
      requested_check_out: checkOut,
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
      <EmployeeShell title="Fix a Missed Punch">
        <p className="text-center text-sm text-slate-400">Loading…</p>
      </EmployeeShell>
    );
  }

  return (
    <EmployeeShell title="Fix a Missed Punch">
      <p className="mb-4 text-sm text-slate-500">Forgot to check in or out? Request a correction and HR/Admin will review it.</p>

      <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
        <input
          type="date"
          required
          value={form.work_date}
          onChange={e => setForm(f => ({ ...f, work_date: e.target.value }))}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Check-in time</label>
            <input
              type="time"
              value={form.check_in_time}
              onChange={e => setForm(f => ({ ...f, check_in_time: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Check-out time</label>
            <input
              type="time"
              value={form.check_out_time}
              onChange={e => setForm(f => ({ ...f, check_out_time: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
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
        <p className="text-center text-sm text-slate-400">No correction requests yet.</p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {requests.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <div className="text-sm font-medium text-ink">{r.work_date}</div>
                <div className="text-xs text-slate-400">
                  In {formatTime(r.requested_check_in)} · Out {formatTime(r.requested_check_out)}
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
