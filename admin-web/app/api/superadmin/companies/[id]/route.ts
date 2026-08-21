import { NextRequest, NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/superadmin';

export const runtime = 'nodejs';

// Read-only, single-company detail — everything scoped to the one
// company_id in the URL. No writes anywhere in this route.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const result = await requireSuperadmin(req);
  if ('response' in result) return result.response;
  const { admin } = result;

  const [companyRes, profilesRes, employeesRes, devicesRes, syncEventsRes] = await Promise.all([
    admin.from('companies').select('id, name, created_at').eq('id', params.id).maybeSingle(),
    admin.from('profiles').select('id, full_name, role, employee_id').eq('company_id', params.id),
    admin.from('employees').select('id, employee_code, name, department, designation, status, date_of_joining').eq('company_id', params.id).order('name'),
    admin.from('devices').select('id, name, ip_address, status, last_sync').eq('company_id', params.id).order('name'),
    admin
      .from('device_sync_events')
      .select('id, device_id, sync_type, status, requested_at, completed_at, error')
      .eq('company_id', params.id)
      .order('requested_at', { ascending: false })
      .limit(100),
  ]);

  if (!companyRes.data) {
    return NextResponse.json({ error: 'Company not found.' }, { status: 404 });
  }

  const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map((usersPage?.users ?? []).map(u => [u.id, u.email ?? '']));

  // Employee-role logins are created via /api/create-login, which links
  // employee_id but never sets profiles.full_name (the real name lives on
  // the employees row instead) — resolve it from there rather than showing
  // "(no name set)" for every employee login, which is the common case.
  const employeeNameById = new Map((employeesRes.data ?? []).map(e => [e.id, e.name]));

  const users = (profilesRes.data ?? []).map(p => ({
    id: p.id,
    name: p.full_name || (p.employee_id ? employeeNameById.get(p.employee_id) : undefined) || '(no name set)',
    email: emailById.get(p.id) ?? '(unknown)',
    role: p.role,
  }));

  // Per-device activity summary: last successful/failed pull (sync_type
  // 'logs' — pulling attendance punches off the device) and last user-list
  // push (sync_type 'users'), each derived from the most recent completed
  // event of that type. "Last active" is devices.last_sync itself, the same
  // field the tenant Devices page already uses to compute online/offline.
  type SyncEvent = {
    id: string;
    device_id: string;
    sync_type: 'users' | 'logs';
    status: string;
    requested_at: string;
    completed_at: string | null;
    error: string | null;
  };
  const eventsByDevice = new Map<string, SyncEvent[]>();
  for (const e of (syncEventsRes.data ?? []) as SyncEvent[]) {
    const list = eventsByDevice.get(e.device_id) ?? [];
    list.push(e);
    eventsByDevice.set(e.device_id, list);
  }
  function lastCompletedOf(deviceId: string, syncType: 'users' | 'logs') {
    const events = eventsByDevice.get(deviceId) ?? [];
    return events.find(e => e.sync_type === syncType && (e.status === 'success' || e.status === 'failed')) ?? null;
  }

  const devices = (devicesRes.data ?? []).map(d => {
    const lastPull = lastCompletedOf(d.id, 'logs');
    const lastUserSync = lastCompletedOf(d.id, 'users');
    return {
      ...d,
      lastPull: lastPull ? { at: lastPull.completed_at ?? lastPull.requested_at, status: lastPull.status, error: lastPull.error } : null,
      lastUserSync: lastUserSync ? { at: lastUserSync.completed_at ?? lastUserSync.requested_at, status: lastUserSync.status, error: lastUserSync.error } : null,
    };
  });

  return NextResponse.json({
    company: { id: companyRes.data.id, name: companyRes.data.name, createdAt: companyRes.data.created_at },
    users,
    employees: employeesRes.data ?? [],
    devices,
  });
}
