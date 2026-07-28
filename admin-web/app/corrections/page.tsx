'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import type { Employee, CorrectionRequest } from '@/lib/types';

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function CorrectionsPage() {
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<'All' | 'pending' | 'approved' | 'rejected'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    supabase
      .from('attendance_correction_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
  }
  useEffect(reload, []);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';

  const filtered = useMemo(
    () => (filter === 'All' ? requests : requests.filter(r => r.status === filter)),
    [requests, filter]
  );

  async function approve(id: string) {
    setBusyId(id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('approve_attendance_correction', { p_request_id: id });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    reload();
  }

  async function reject(id: string) {
    setBusyId(id);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from('attendance_correction_requests')
      .update({ status: 'rejected', reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', id);
    setBusyId(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    reload();
  }

  return (
    <AppShell title="Attendance Corrections">
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Requests from employees who missed a punch. Approving one recalculates that day&apos;s hours, late/early status,
        and overtime using the requested times, and locks the day so the nightly recompute won&apos;t overwrite it.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected', 'All'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
              filter === f ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-critical">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Requested In</th>
              <th className="px-5 py-3 font-medium">Requested Out</th>
              <th className="px-5 py-3 font-medium">Reason</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 font-medium text-ink">{employeeName(r.employee_id)}</td>
                <td className="px-5 py-3 text-slate-600">{r.work_date}</td>
                <td className="px-5 py-3 text-slate-600">{formatTime(r.requested_check_in)}</td>
                <td className="px-5 py-3 text-slate-600">{formatTime(r.requested_check_out)}</td>
                <td className="px-5 py-3 max-w-xs truncate text-slate-600">{r.reason ?? '—'}</td>
                <td className="px-5 py-3">
                  <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'critical' : 'warning'}>
                    {r.status}
                  </Badge>
                </td>
                <td className="px-5 py-3">
                  {r.status === 'pending' ? (
                    <div className="flex gap-2">
                      <button
                        disabled={busyId === r.id}
                        onClick={() => approve(r.id)}
                        className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={busyId === r.id}
                        onClick={() => reject(r.id)}
                        className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">Reviewed</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
                  No {filter !== 'All' ? filter : ''} correction requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
