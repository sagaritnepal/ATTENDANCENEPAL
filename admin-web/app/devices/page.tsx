'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import type { AttendanceLog, Branch, Device, Employee } from '@/lib/types';

const EMPTY_FORM = { name: '', branch_id: '', ip_address: '192.168.1.201', port: 4370 };

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function reload() {
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
    supabase.from('branches').select('*').then(({ data }) => setBranches(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
    supabase.from('attendance_logs').select('*').eq('method', 'zkteco').then(({ data }) => setLogs(data ?? []));
  }
  useEffect(reload, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from('devices').insert({
      name: form.name,
      branch_id: form.branch_id,
      ip_address: form.ip_address,
      port: form.port,
      status: 'offline',
    });
    setSaving(false);
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
  }

  return (
    <AppShell title="Biometric Sync Devices">
      <div className="mb-5 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Biometric terminal integrations — <code className="rounded bg-slate-100 px-1.5 py-0.5">zkteco-bridge</code> polls each device
          every 5 minutes and writes here.
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
              </div>
            </div>
          );
        })}
        {devices.length === 0 && <p className="text-sm text-slate-400">No devices registered yet.</p>}
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
