'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Employee, CorrectionRequest, AttendanceGpsRequest } from '@/lib/types';

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function CorrectionsPage() {
  const { system } = useCalendarSystem();
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<'All' | 'pending' | 'approved' | 'rejected'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [gpsRequests, setGpsRequests] = useState<AttendanceGpsRequest[]>([]);
  const [gpsFilter, setGpsFilter] = useState<'All' | 'pending' | 'approved' | 'rejected'>('pending');
  const [gpsBusyId, setGpsBusyId] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  function reload() {
    supabase
      .from('attendance_correction_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests(data ?? []));
    supabase
      .from('attendance_gps_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setGpsRequests(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
  }
  useEffect(reload, []);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';

  const filtered = useMemo(
    () => (filter === 'All' ? requests : requests.filter(r => r.status === filter)),
    [requests, filter]
  );

  const gpsFiltered = useMemo(
    () => (gpsFilter === 'All' ? gpsRequests : gpsRequests.filter(r => r.status === gpsFilter)),
    [gpsRequests, gpsFilter]
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

  async function approveGps(id: string) {
    setGpsBusyId(id);
    setGpsError(null);
    const { error: rpcError } = await supabase.rpc('approve_attendance_gps_request', { p_request_id: id });
    setGpsBusyId(null);
    if (rpcError) {
      setGpsError(rpcError.message);
      return;
    }
    reload();
  }

  async function rejectGps(id: string) {
    setGpsBusyId(id);
    setGpsError(null);
    const { data } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from('attendance_gps_requests')
      .update({ status: 'rejected', reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', id);
    setGpsBusyId(null);
    if (updateError) {
      setGpsError(updateError.message);
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
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 font-medium text-ink">{employeeName(r.employee_id)}</td>
                <td className="px-5 py-3 text-slate-600">{formatAdDate(r.work_date, system)}</td>
                <td className="px-5 py-3 text-slate-600">{formatTime(r.requested_check_in)}</td>
                <td className="px-5 py-3 text-slate-600">{formatTime(r.requested_check_out)}</td>
                <td className="px-5 py-3 max-w-xs truncate text-slate-600">{r.reason ?? '—'}</td>
                <td className="px-5 py-3 text-slate-600">
                  {r.lat != null && r.lng != null ? (
                    <a
                      href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      View
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
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
                <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                  No {filter !== 'All' ? filter : ''} correction requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mb-4 mt-8 text-lg font-semibold text-ink">GPS Check-in Requests</h2>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Every check-in/check-out an employee submits from their phone waits here until Admin/HR approves it —
        approving inserts the punch into attendance so it counts for that day.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected', 'All'] as const).map(f => (
          <button
            key={f}
            onClick={() => setGpsFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
              gpsFilter === f ? 'bg-accent text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {gpsError && <p className="mb-4 text-sm text-critical">{gpsError}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Time</th>
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {gpsFiltered.map(r => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 font-medium text-ink">{employeeName(r.employee_id)}</td>
                <td className="px-5 py-3 text-slate-600">{r.punch_type === '0' ? 'Check In' : 'Check Out'}</td>
                <td className="px-5 py-3 text-slate-600">{new Date(r.punch_time).toLocaleString()}</td>
                <td className="px-5 py-3 text-slate-600">
                  {r.lat != null && r.lng != null ? (
                    <a
                      href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      View
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-5 py-3">
                  <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'critical' : 'warning'}>
                    {r.status}
                  </Badge>
                </td>
                <td className="px-5 py-3">
                  {r.status === 'pending' ? (
                    <div className="flex gap-2">
                      <button
                        disabled={gpsBusyId === r.id}
                        onClick={() => approveGps(r.id)}
                        className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={gpsBusyId === r.id}
                        onClick={() => rejectGps(r.id)}
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
            {gpsFiltered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                  No {gpsFilter !== 'All' ? gpsFilter : ''} GPS check-in requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
