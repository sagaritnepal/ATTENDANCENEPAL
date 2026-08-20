'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { punchTypeLabel } from '@/lib/shift';
import type { Employee, CorrectionRequest, AttendanceGpsRequest } from '@/lib/types';

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type UnifiedRequest =
  | { kind: 'correction'; id: string; employee_id: string; status: string; created_at: string; data: CorrectionRequest }
  | { kind: 'gps'; id: string; employee_id: string; status: string; created_at: string; data: AttendanceGpsRequest };

export default function CorrectionsPage() {
  const { system } = useCalendarSystem();
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [gpsRequests, setGpsRequests] = useState<AttendanceGpsRequest[]>([]);
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
    supabase
      .from('attendance_gps_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => setGpsRequests(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
  }
  useEffect(reload, []);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';

  const unified: UnifiedRequest[] = useMemo(() => {
    const corrections: UnifiedRequest[] = requests.map(r => ({
      kind: 'correction',
      id: r.id,
      employee_id: r.employee_id,
      status: r.status,
      created_at: r.created_at,
      data: r,
    }));
    const gps: UnifiedRequest[] = gpsRequests.map(r => ({
      kind: 'gps',
      id: r.id,
      employee_id: r.employee_id,
      status: r.status,
      created_at: r.created_at,
      data: r,
    }));
    return [...corrections, ...gps].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [requests, gpsRequests]);

  const filtered = useMemo(
    () => (filter === 'All' ? unified : unified.filter(r => r.status === filter)),
    [unified, filter]
  );

  async function approve(item: UnifiedRequest) {
    setBusyId(item.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc(
      item.kind === 'correction' ? 'approve_attendance_correction' : 'approve_attendance_gps_request',
      { p_request_id: item.id }
    );
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    reload();
  }

  async function reject(item: UnifiedRequest) {
    setBusyId(item.id);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const { error: updateError } = await supabase
      .from(item.kind === 'correction' ? 'attendance_correction_requests' : 'attendance_gps_requests')
      .update({ status: 'rejected', reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() })
      .eq('id', item.id);
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
        Requests from employees — a missed punch they&apos;re asking to fix, or a live check-in/check-out submitted
        from their phone. Approving a missed punch recalculates that day&apos;s hours, late/early status, and
        overtime, and locks the day so the nightly recompute won&apos;t overwrite it. Approving a GPS check-in
        records it as that day&apos;s attendance.
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

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="divide-y divide-slate-100 md:hidden">
          {filtered.map(item => {
            const lat = item.kind === 'correction' ? item.data.lat : item.data.lat;
            const lng = item.kind === 'correction' ? item.data.lng : item.data.lng;
            return (
              <div key={`${item.kind}-${item.id}`} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{employeeName(item.employee_id)}</div>
                    <div className="text-xs text-slate-500">
                      {item.kind === 'correction' ? 'Missed Punch' : punchTypeLabel(item.data.punch_type)} ·{' '}
                      {item.kind === 'correction'
                        ? formatAdDate(item.data.work_date, system)
                        : formatAdDate(item.data.punch_time.slice(0, 10), system)}
                    </div>
                  </div>
                  <Badge tone={item.status === 'approved' ? 'good' : item.status === 'rejected' ? 'critical' : 'warning'}>
                    {item.status}
                  </Badge>
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  {item.kind === 'correction'
                    ? `In ${formatTime(item.data.requested_check_in)} · Out ${formatTime(item.data.requested_check_out)}`
                    : formatTime(item.data.punch_time)}
                </div>
                {item.kind === 'correction' && item.data.reason && (
                  <div className="mt-1 text-xs text-slate-500">{item.data.reason}</div>
                )}
                {lat != null && lng != null && (
                  <a
                    href={`https://www.google.com/maps?q=${lat},${lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-accent hover:underline"
                  >
                    View location
                  </a>
                )}
                {item.status === 'pending' && (
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busyId === item.id}
                      onClick={() => approve(item)}
                      className="rounded-md bg-good px-3 py-1.5 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      disabled={busyId === item.id}
                      onClick={() => reject(item)}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <p className="p-8 text-center text-sm text-slate-400">No {filter !== 'All' ? filter : ''} requests.</p>}
        </div>

        <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Employee</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Details</th>
              <th className="px-5 py-3 font-medium">Reason</th>
              <th className="px-5 py-3 font-medium">Location</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => {
              const lat = item.kind === 'correction' ? item.data.lat : item.data.lat;
              const lng = item.kind === 'correction' ? item.data.lng : item.data.lng;
              return (
                <tr key={`${item.kind}-${item.id}`} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 font-medium text-ink">{employeeName(item.employee_id)}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {item.kind === 'correction' ? 'Missed Punch' : punchTypeLabel(item.data.punch_type)}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {item.kind === 'correction'
                      ? formatAdDate(item.data.work_date, system)
                      : formatAdDate(item.data.punch_time.slice(0, 10), system)}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {item.kind === 'correction'
                      ? `In ${formatTime(item.data.requested_check_in)} · Out ${formatTime(item.data.requested_check_out)}`
                      : formatTime(item.data.punch_time)}
                  </td>
                  <td className="px-5 py-3 max-w-xs truncate text-slate-600">
                    {item.kind === 'correction' ? item.data.reason ?? '—' : '—'}
                  </td>
                  <td className="px-5 py-3 text-slate-600">
                    {lat != null && lng != null ? (
                      <a
                        href={`https://www.google.com/maps?q=${lat},${lng}`}
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
                    <Badge tone={item.status === 'approved' ? 'good' : item.status === 'rejected' ? 'critical' : 'warning'}>
                      {item.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-3">
                    {item.status === 'pending' ? (
                      <div className="flex gap-2">
                        <button
                          disabled={busyId === item.id}
                          onClick={() => approve(item)}
                          className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          disabled={busyId === item.id}
                          onClick={() => reject(item)}
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
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-8 text-center text-slate-400">
                  No {filter !== 'All' ? filter : ''} requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </AppShell>
  );
}
