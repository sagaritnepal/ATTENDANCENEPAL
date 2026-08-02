'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import type { AttendanceLog, Branch, Device, DeviceSyncEvent, Employee } from '@/lib/types';

const EMPTY_FORM = { name: '', branch_id: '', ip_address: '192.168.1.201', port: 4370 };

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [syncEvents, setSyncEvents] = useState<DeviceSyncEvent[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [queuing, setQueuing] = useState<string | null>(null);

  function reload() {
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
    supabase.from('branches').select('*').then(({ data }) => setBranches(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
    supabase.from('attendance_logs').select('*').eq('method', 'zkteco').then(({ data }) => setLogs(data ?? []));
    supabase
      .from('device_sync_events')
      .select('*')
      .order('requested_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setSyncEvents(data ?? []));
  }
  useEffect(reload, []);

  // Reflects zkteco-bridge's status/last_sync writes the moment they land, instead of
  // requiring a manual "Refresh" click.
  useEffect(() => {
    const channel = supabase
      .channel('devices-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'devices' }, payload => {
        setDevices(prev => [...prev, payload.new as Device]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices' }, payload => {
        const updated = payload.new as Device;
        setDevices(prev => prev.map(d => (d.id === updated.id ? updated : d)));
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'devices' }, payload => {
        const removed = payload.old as Device;
        setDevices(prev => prev.filter(d => d.id !== removed.id));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // While anything is still queued/running, poll every 3s so a click on
  // "Sync Users"/"Sync Log" reflects zkteco-bridge picking it up and
  // finishing without the admin having to hit Refresh themselves.
  useEffect(() => {
    if (!syncEvents.some(e => e.status === 'pending' || e.status === 'running')) return;
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [syncEvents]);

  async function queueSync(deviceId: string, syncType: 'users' | 'logs') {
    setQueuing(`${deviceId}-${syncType}`);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from('device_sync_events').insert({
      device_id: deviceId,
      sync_type: syncType,
      requested_by: user?.id ?? null,
    });
    setQueuing(null);
    if (error) alert(`Could not queue sync: ${error.message}`);
    reload();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from('devices').insert({
      name: form.name,
      branch_id: form.branch_id,
      ip_address: form.ip_address,
      port: form.port,
    });
    setSaving(false);
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this device? Past punches synced from it are kept, but it will stop being polled.')) return;
    const { error } = await supabase.from('devices').delete().eq('id', id);
    if (error) alert(`Could not remove: ${error.message}`);
    reload();
  }

  return (
    <AppShell title="Biometric Sync Devices">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-slate-500 max-w-2xl">
          Biometric terminal integrations — <code className="rounded bg-slate-100 px-1.5 py-0.5">zkteco-bridge</code> polls every device
          every 15 seconds and writes here. "Sync Users"/"Sync Log" queue an on-demand request that the bridge — running on a
          machine on the same network as the device — picks up right away.
        </p>
        <div className="flex gap-2">
          <button onClick={reload} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ⟳ Refresh
          </button>
          <button onClick={() => setShowForm(true)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90">
            + Add Device
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {devices.map(d => {
          const branch = branches.find(b => b.id === d.branch_id);
          const registered = employees.filter(e => e.branch_id === d.branch_id && e.fingerprint_id).length;
          const fetched = logs.filter(l => l.device_id === d.id).length;
          const deviceEvents = syncEvents.filter(e => e.device_id === d.id);
          const busy = (type: 'users' | 'logs') =>
            queuing === `${d.id}-${type}` ||
            deviceEvents.some(e => e.sync_type === type && (e.status === 'pending' || e.status === 'running'));
          return (
            <div key={d.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-ink">{d.name}</h3>
                <Badge tone={d.status === 'online' ? 'good' : 'critical'}>{d.status}</Badge>
              </div>
              <p className="mb-3 text-sm text-slate-500">{d.ip_address}:{d.port}</p>
              <p className="text-sm text-slate-600">📍 {branch?.name ?? 'Unassigned branch'}</p>
              <p className="text-sm text-slate-600">
                🔄 Last sync: {d.last_sync ? new Date(d.last_sync).toLocaleString() : 'never'}
              </p>
              <p className="text-sm text-slate-600">👥 Registered: {registered} staff</p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                <span className="font-medium text-accent">{fetched} punches fetched</span>
                <button onClick={() => handleDelete(d.id)} className="text-xs font-medium text-critical hover:underline">
                  Remove
                </button>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => queueSync(d.id, 'users')}
                  disabled={busy('users')}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy('users') ? 'Syncing users…' : '👥 Sync Users'}
                </button>
                <button
                  onClick={() => queueSync(d.id, 'logs')}
                  disabled={busy('logs')}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy('logs') ? 'Syncing log…' : '🕐 Sync Log'}
                </button>
              </div>
            </div>
          );
        })}
        {devices.length === 0 && <p className="text-sm text-slate-400">No devices registered yet.</p>}
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink">Sync History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Device</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Requested</th>
                <th className="px-5 py-3 font-medium">Completed</th>
                <th className="px-5 py-3 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {syncEvents.map(e => {
                const device = devices.find(d => d.id === e.device_id);
                return (
                  <tr key={e.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3 font-medium text-ink">{device?.name ?? 'Unknown device'}</td>
                    <td className="px-5 py-3 text-slate-600">{e.sync_type === 'users' ? '👥 Users' : '🕐 Log'}</td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={
                          e.status === 'success' ? 'good' : e.status === 'failed' ? 'critical' : e.status === 'running' ? 'info' : 'neutral'
                        }
                      >
                        {e.status}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{new Date(e.requested_at).toLocaleString()}</td>
                    <td className="px-5 py-3 text-slate-600">{e.completed_at ? new Date(e.completed_at).toLocaleString() : '—'}</td>
                    <td className="px-5 py-3 max-w-xs">
                      {e.summary && <span className="text-slate-600">{e.summary}</span>}
                      {e.error && <span className="text-critical">{e.error}</span>}
                      {!e.summary && !e.error && <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
              {syncEvents.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                    No sync requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleCreate} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Device</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <label className="mb-1 block text-xs font-medium text-slate-600">Branch</label>
            <select required value={form.branch_id} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))} className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Select a branch…</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">IP address</label>
                <input value={form.ip_address} onChange={e => setForm(f => ({ ...f, ip_address: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Port</label>
                <input type="number" value={form.port} onChange={e => setForm(f => ({ ...f, port: Number(e.target.value) }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" disabled={saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60">
                {saving ? 'Saving…' : 'Add device'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
