'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import Badge from '@/components/Badge';

type User = { id: string; name: string; email: string; role: string };
type EmployeeRow = {
  id: string;
  employee_code: string;
  name: string;
  department: string | null;
  designation: string | null;
  status: 'active' | 'inactive';
  date_of_joining: string | null;
};
type SyncSummary = { at: string; status: string; error: string | null } | null;
type DeviceRow = {
  id: string;
  name: string;
  ip_address: string;
  status: 'online' | 'offline';
  last_sync: string | null;
  lastPull: SyncSummary;
  lastUserSync: SyncSummary;
};
type Detail = { company: { id: string; name: string; createdAt: string }; users: User[]; employees: EmployeeRow[]; devices: DeviceRow[] };

// Read-only detail view for one company — fetches on open via
// /api/superadmin/companies/[id], scoped to that company only.
export default function CompanyDetailModal({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/superadmin/companies/${companyId}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!active) return;
      if (!res.ok) {
        setError(body.error ?? 'Could not load company details.');
        return;
      }
      setDetail(body);
    });
    return () => {
      active = false;
    };
  }, [companyId]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-ink">{detail?.company.name ?? 'Loading…'}</h3>
            {detail && <p className="text-xs text-slate-500">Signed up {new Date(detail.company.createdAt).toLocaleDateString()}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-critical">{error}</p>}
        {!detail && !error && <p className="text-sm text-slate-400">Loading…</p>}

        {detail && (
          <div className="space-y-6">
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-ink">Admin / HR / Employee logins ({detail.users.length})</h4>
                <Link
                  href={`/superadmin/companies/${detail.company.id}/dashboard`}
                  className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
                >
                  View their Dashboard (read-only)
                </Link>
              </div>
              {detail.users.length === 0 ? (
                <p className="text-xs text-slate-400">None found.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.users.map(u => (
                    <li key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{u.name}</div>
                        <div className="truncate text-xs text-slate-500">{u.email}</div>
                      </div>
                      <Badge tone={u.role === 'admin' ? 'info' : u.role === 'hr' ? 'good' : 'neutral'}>{u.role}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-ink">Employees ({detail.employees.length})</h4>
              {detail.employees.length === 0 ? (
                <p className="text-xs text-slate-400">No employees on record.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.employees.map(e => (
                    <li key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-ink">{e.name}</div>
                        <div className="truncate text-xs text-slate-500">
                          {e.employee_code}
                          {e.department ? ` · ${e.department}` : ''}
                          {e.designation ? ` · ${e.designation}` : ''}
                        </div>
                      </div>
                      <Badge tone={e.status === 'active' ? 'good' : 'neutral'}>{e.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-sm font-semibold text-ink">Devices ({detail.devices.length})</h4>
              {detail.devices.length === 0 ? (
                <p className="text-xs text-slate-400">No devices registered.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.devices.map(d => (
                    <li key={d.id} className="rounded-lg border border-slate-100 px-3 py-2 text-sm">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{d.name}</div>
                          <div className="truncate text-xs text-slate-500">{d.ip_address}</div>
                        </div>
                        <Badge tone={d.status === 'online' ? 'good' : 'critical'}>{d.status}</Badge>
                      </div>
                      <div className="space-y-1 border-t border-slate-100 pt-1.5 text-xs text-slate-500">
                        <div>Last active: {d.last_sync ? new Date(d.last_sync).toLocaleString() : 'never'}</div>
                        <div className="flex items-center gap-1.5">
                          Last pull (attendance logs):{' '}
                          {d.lastPull ? (
                            <>
                              {new Date(d.lastPull.at).toLocaleString()}
                              <Badge tone={d.lastPull.status === 'success' ? 'good' : 'critical'}>{d.lastPull.status}</Badge>
                            </>
                          ) : (
                            'never'
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          Last user sync:{' '}
                          {d.lastUserSync ? (
                            <>
                              {new Date(d.lastUserSync.at).toLocaleString()}
                              <Badge tone={d.lastUserSync.status === 'success' ? 'good' : 'critical'}>{d.lastUserSync.status}</Badge>
                            </>
                          ) : (
                            'never'
                          )}
                        </div>
                        {(d.lastPull?.error || d.lastUserSync?.error) && (
                          <div className="text-critical">Last error: {d.lastPull?.error ?? d.lastUserSync?.error}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
