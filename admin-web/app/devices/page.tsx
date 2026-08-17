'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import type { AttendanceLog, Branch, Device, Employee } from '@/lib/types';

const EMPTY_FORM = { name: '', branch_id: '', ip_address: '192.168.1.201', port: 4370, serial_number: '' };

function deviceErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'That serial number is already registered to another device.';
  return error.message;
}

type BridgeCredential = { id: string; email: string; createdAt: string };
type BridgeResult = { email: string; password: string; envFile: string };

function downloadEnvFile(envFile: string) {
  const blob = new Blob([envFile], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '.env';
  a.click();
  URL.revokeObjectURL(url);
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [bridgeCredentials, setBridgeCredentials] = useState<BridgeCredential[]>([]);
  const [generatingBridge, setGeneratingBridge] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [bridgeResult, setBridgeResult] = useState<BridgeResult | null>(null);
  const [revokingBridgeId, setRevokingBridgeId] = useState<string | null>(null);

  function reload() {
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
    supabase.from('branches').select('*').then(({ data }) => setBranches(data ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees(data ?? []));
    supabase.from('attendance_logs').select('*').eq('method', 'zkteco').then(({ data }) => setLogs(data ?? []));
    loadBridgeCredentials();
  }
  useEffect(reload, []);

  async function loadBridgeCredentials() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return;
    const res = await fetch('/api/bridge-credentials', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setBridgeCredentials(body.credentials ?? []);
  }

  async function handleGenerateBridge() {
    setGeneratingBridge(true);
    setBridgeError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setGeneratingBridge(false);
      setBridgeError('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/bridge-credentials', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setGeneratingBridge(false);
    if (!res.ok) {
      setBridgeError(body.error ?? 'Could not generate the credential.');
      return;
    }
    setBridgeResult({ email: body.email, password: body.password, envFile: body.envFile });
    loadBridgeCredentials();
  }

  async function handleRevokeBridge(id: string) {
    if (!confirm('Revoke this bridge credential? Any machine still using it will stop being able to sync immediately.')) return;
    setRevokingBridgeId(id);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setRevokingBridgeId(null);
      alert('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/bridge-credentials', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
    const body = await res.json().catch(() => ({}));
    setRevokingBridgeId(null);
    if (!res.ok) {
      alert(body.error ?? 'Could not revoke the credential.');
      return;
    }
    loadBridgeCredentials();
  }

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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const { error } = await supabase.from('devices').insert({
      name: form.name,
      branch_id: form.branch_id || null,
      ip_address: form.ip_address,
      port: form.port,
      serial_number: form.serial_number,
    });
    setSaving(false);
    if (error) {
      setFormError(deviceErrorMessage(error));
      return;
    }
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

  function openEdit(d: Device) {
    setEditingDevice(d);
    setEditForm({
      name: d.name,
      branch_id: d.branch_id ?? '',
      ip_address: d.ip_address,
      port: d.port,
      serial_number: d.serial_number ?? '',
    });
    setEditError(null);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDevice) return;
    setSavingEdit(true);
    setEditError(null);
    const { error } = await supabase
      .from('devices')
      .update({
        name: editForm.name,
        branch_id: editForm.branch_id || null,
        ip_address: editForm.ip_address,
        port: editForm.port,
        serial_number: editForm.serial_number || null,
      })
      .eq('id', editingDevice.id);
    setSavingEdit(false);
    if (error) {
      setEditError(deviceErrorMessage(error));
      return;
    }
    setEditingDevice(null);
    reload();
  }

  return (
    <AppShell title="Biometric Sync Devices">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Biometric terminal integrations, synced automatically both ways — no manual sync needed. Renaming an employee here pushes
          that name back down to every device. For a cloud-connected device, a punch from a fingerprint the app doesn&apos;t
          recognize yet creates a placeholder employee right away; for a LAN-bridge device, register the employee first and set
          their Biometric/Registration ID to match, or its punches are skipped rather than recorded.
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
              <p className="text-sm text-slate-600">🔢 Serial: {d.serial_number ?? '—'}</p>
              <p className="text-sm text-slate-600">
                🔄 Last sync: {d.last_sync ? new Date(d.last_sync).toLocaleString() : 'never'}
              </p>
              <p className="text-sm text-slate-600">👥 Registered: {registered} staff</p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
                <span className="font-medium text-accent">{fetched} punches fetched</span>
                <div className="flex gap-3">
                  <button onClick={() => openEdit(d)} className="text-xs font-medium text-slate-600 hover:underline">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(d.id)} className="text-xs font-medium text-critical hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {devices.length === 0 && <p className="text-sm text-slate-400">No devices registered yet.</p>}
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Device Bridge Credentials</h2>
            <p className="mt-1 max-w-2xl text-xs text-slate-500">
              For a device that only reaches you over a local network, not the internet: generate a credential scoped to
              just this company, and hand its <code className="rounded bg-slate-100 px-1 py-0.5">.env</code> file to
              whoever runs the bridge on-site — no GitHub access or shared master key involved.
            </p>
          </div>
          <button
            onClick={handleGenerateBridge}
            disabled={generatingBridge}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {generatingBridge ? 'Generating…' : '+ Generate Bridge Credentials'}
          </button>
        </div>
        {bridgeError && <p className="mb-3 text-sm text-critical">{bridgeError}</p>}
        {bridgeCredentials.length === 0 ? (
          <p className="text-sm text-slate-400">No bridge credentials issued yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {bridgeCredentials.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-ink">{c.email}</div>
                  <div className="text-xs text-slate-400">Issued {new Date(c.createdAt).toLocaleString()}</div>
                </div>
                <button
                  onClick={() => handleRevokeBridge(c.id)}
                  disabled={revokingBridgeId === c.id}
                  className="shrink-0 text-xs font-medium text-critical hover:underline disabled:opacity-60"
                >
                  {revokingBridgeId === c.id ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {bridgeResult && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-1 text-lg font-semibold text-ink">Bridge credential created</h3>
            <p className="mb-4 text-xs text-slate-500">
              This password won&apos;t be shown again. Download the <code className="rounded bg-slate-100 px-1 py-0.5">.env</code>{' '}
              below and place it alongside <code className="rounded bg-slate-100 px-1 py-0.5">index.js</code> on the
              on-site machine.
            </p>
            <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
              <div>
                <span className="text-xs uppercase text-slate-400">Email</span>
                <div className="break-all font-mono text-xs font-medium text-ink">{bridgeResult.email}</div>
              </div>
              <div>
                <span className="text-xs uppercase text-slate-400">Password</span>
                <div className="break-all font-mono text-xs font-medium text-ink">{bridgeResult.password}</div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => downloadEnvFile(bridgeResult.envFile)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                ⬇ Download .env
              </button>
              <button
                onClick={() => setBridgeResult(null)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleCreate} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Device</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <label className="mb-1 block text-xs font-medium text-slate-600">Branch (optional)</label>
            <select value={form.branch_id} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))} className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">Unassigned</option>
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
            <label className="mb-1 block text-xs font-medium text-slate-600">Serial number</label>
            <input
              required
              value={form.serial_number}
              onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))}
              placeholder="Unique per device — printed on the unit"
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {formError && <p className="mb-3 text-sm text-critical">{formError}</p>}
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

      {editingDevice && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleEdit} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">Edit Device</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              required
              value={editForm.name}
              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Branch (optional)</label>
            <select
              value={editForm.branch_id}
              onChange={e => setEditForm(f => ({ ...f, branch_id: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">IP address</label>
                <input
                  value={editForm.ip_address}
                  onChange={e => setEditForm(f => ({ ...f, ip_address: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Port</label>
                <input
                  type="number"
                  value={editForm.port}
                  onChange={e => setEditForm(f => ({ ...f, port: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Serial number</label>
            <input
              required
              value={editForm.serial_number}
              onChange={e => setEditForm(f => ({ ...f, serial_number: e.target.value }))}
              placeholder="Unique per device — printed on the unit"
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {editError && <p className="mb-3 text-sm text-critical">{editError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEditingDevice(null)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button type="submit" disabled={savingEdit} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60">
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
