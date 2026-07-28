'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import type { Branch } from '@/lib/types';

const EMPTY_FORM = { name: '', branch_code: '', latitude: '', longitude: '', radius_meters: 150 };

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  function reload() {
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches(data ?? []));
  }
  useEffect(reload, []);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setLocateError(null);
    setShowForm(true);
  }

  function openEdit(b: Branch) {
    setEditing(b);
    setForm({
      name: b.name,
      branch_code: b.branch_code,
      latitude: String(b.latitude),
      longitude: String(b.longitude),
      radius_meters: b.radius_meters,
    });
    setFormError(null);
    setLocateError(null);
    setShowForm(true);
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocateError('This browser does not support location access.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocating(false);
        setForm(f => ({ ...f, latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) }));
      },
      err => {
        setLocating(false);
        setLocateError(err.message);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.latitude || !form.longitude || Number.isNaN(lat) || Number.isNaN(lng)) {
      setFormError('Set the branch location — use "Use my current location" while standing there, or enter coordinates manually.');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name,
      branch_code: form.branch_code,
      latitude: lat,
      longitude: lng,
      radius_meters: form.radius_meters,
    };
    const { error } = editing
      ? await supabase.from('branches').update(payload).eq('id', editing.id)
      : await supabase.from('branches').insert(payload);
    setSaving(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setShowForm(false);
    reload();
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this branch? Employees/devices assigned to it will need reassigning.')) return;
    const { error } = await supabase.from('branches').delete().eq('id', id);
    if (error) alert(`Could not remove: ${error.message}`);
    reload();
  }

  return (
    <AppShell title="Branches">
      <p className="mb-5 max-w-2xl text-sm text-slate-500">
        The location + radius each branch uses for GPS check-in. An employee must be assigned to a branch (Employees
        page) for their GPS check-in to work at all — without one, the server rejects every GPS punch.
      </p>

      <div className="mb-5 flex justify-end">
        <button onClick={openAdd} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90">
          + Add Branch
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {branches.map(b => (
          <div key={b.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-1 font-semibold text-ink">{b.name}</h3>
            <p className="mb-3 text-xs text-slate-400">{b.branch_code}</p>
            <p className="text-sm text-slate-600">
              📍 {b.latitude.toFixed(5)}, {b.longitude.toFixed(5)}
            </p>
            <p className="text-sm text-slate-600">↔ {b.radius_meters}m radius</p>
            <div className="mt-4 flex gap-3 border-t border-slate-100 pt-3 text-xs font-medium">
              <button onClick={() => openEdit(b)} className="text-accent hover:underline">
                Edit
              </button>
              <button onClick={() => handleDelete(b.id)} className="text-critical hover:underline">
                Remove
              </button>
            </div>
          </div>
        ))}
        {branches.length === 0 && <p className="text-sm text-slate-400">No branches yet — add one to enable GPS check-in.</p>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleSave} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">{editing ? 'Edit Branch' : 'Add Branch'}</h3>

            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <label className="mb-1 block text-xs font-medium text-slate-600">Branch code</label>
            <input
              required
              value={form.branch_code}
              onChange={e => setForm(f => ({ ...f, branch_code: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />

            <button
              type="button"
              onClick={useCurrentLocation}
              disabled={locating}
              className="mb-3 w-full rounded-lg border border-accent py-2 text-sm font-semibold text-accent disabled:opacity-60"
            >
              {locating ? 'Getting location…' : '📍 Use my current location'}
            </button>
            {locateError && <p className="mb-3 text-xs text-critical">{locateError}</p>}
            <p className="mb-3 text-xs text-slate-400">Stand at the branch/office before tapping this.</p>

            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Latitude</label>
                <input
                  required
                  value={form.latitude}
                  onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Longitude</label>
                <input
                  required
                  value={form.longitude}
                  onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <label className="mb-1 block text-xs font-medium text-slate-600">Radius (meters)</label>
            <input
              type="number"
              min={10}
              required
              value={form.radius_meters}
              onChange={e => setForm(f => ({ ...f, radius_meters: Number(e.target.value) }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <p className="mb-3 text-xs text-slate-400">
              How far (in meters) from this point an employee can still check in — e.g. 150 covers most of a single
              office building.
            </p>

            {formError && <p className="mb-3 text-sm text-critical">{formError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add branch'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
