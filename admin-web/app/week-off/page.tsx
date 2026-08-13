'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import { fetchMyCompanyWeekOffConfig } from '@/lib/weekOff';
import type { CompanyHoliday } from '@/lib/types';

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const EMPTY_FORM = { holiday_date: '', name: '' };

// Best-effort: the Edge Function that actually sends push notifications is
// separate infrastructure (needs an Expo/EAS project + `supabase functions
// deploy`, both requiring credentials this app doesn't have) — until that's
// deployed, this call harmlessly no-ops (Supabase returns a "not found"
// error for an undeployed function, which we swallow rather than blocking
// the admin's save).
async function notifyWeekOffChange() {
  try {
    await supabase.functions.invoke('notify-week-off');
  } catch {
    // Not deployed yet — see supabase/functions/notify-week-off/README.md.
  }
}

export default function WeekOffPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [savingWeeklyDay, setSavingWeeklyDay] = useState(false);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  function reload() {
    fetchMyCompanyWeekOffConfig().then(({ companyId, weeklyOffDay }) => {
      setCompanyId(companyId);
      setWeeklyOffDay(weeklyOffDay);
    });
    supabase
      .from('company_holidays')
      .select('*')
      .order('holiday_date', { ascending: true })
      .then(({ data }) => {
        setHolidays(data ?? []);
        setLoading(false);
      });
  }
  useEffect(reload, []);

  async function handleWeeklyDayChange(value: string) {
    if (!companyId) return;
    const day = value === '' ? null : Number(value);
    setSavingWeeklyDay(true);
    const { error } = await supabase.from('companies').update({ weekly_off_day: day }).eq('id', companyId);
    setSavingWeeklyDay(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setWeeklyOffDay(day);
    notifyWeekOffChange();
  }

  async function handleAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!form.holiday_date || !form.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('company_holidays').insert({ holiday_date: form.holiday_date, name: form.name.trim() });
    setSaving(false);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setForm(EMPTY_FORM);
    setShowForm(false);
    reload();
    notifyWeekOffChange();
  }

  async function handleDeleteHoliday(id: string) {
    if (!confirm('Delete this holiday?')) return;
    const { error } = await supabase.from('company_holidays').delete().eq('id', id);
    if (error) alert(`Couldn't delete: ${error.message}`);
    reload();
  }

  return (
    <AppShell title="Week-off">
      <p className="mb-5 max-w-2xl text-sm text-slate-500">
        Company-wide non-working days — a recurring weekly day (e.g. every Saturday) plus specific holiday dates.
        Applies to every employee at once, is treated as a paid day in Payroll, and is distinct from assigning one
        employee a Week Off on the Shifts page&apos;s Weekly Roster.
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-base font-semibold text-ink">Weekly off day</h2>
        <p className="mb-3 text-sm text-slate-500">The one day every week nobody is expected to work.</p>
        <select
          value={weeklyOffDay ?? ''}
          disabled={savingWeeklyDay || !companyId}
          onChange={e => handleWeeklyDayChange(e.target.value)}
          className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
        >
          <option value="">None</option>
          {WEEKDAY_LABELS.map((label, i) => (
            <option key={i} value={i}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Holidays</h2>
          <button
            onClick={() => {
              setForm(EMPTY_FORM);
              setShowForm(true);
            }}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
          >
            + New Holiday
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="whitespace-nowrap py-2 pr-4 font-medium">Date</th>
                <th className="whitespace-nowrap py-2 pr-4 font-medium">Name</th>
                <th className="whitespace-nowrap py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {holidays.map(h => (
                <tr key={h.id} className="border-b border-slate-100 last:border-0">
                  <td className="whitespace-nowrap py-2.5 pr-4 text-slate-600">{h.holiday_date}</td>
                  <td className="whitespace-nowrap py-2.5 pr-4 font-medium text-ink">{h.name}</td>
                  <td className="whitespace-nowrap py-2.5">
                    <button onClick={() => handleDeleteHoliday(h.id)} className="text-xs font-medium text-critical hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && holidays.length === 0 && <p className="py-4 text-sm text-slate-400">No holidays added yet.</p>}
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleAddHoliday} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-ink">New Holiday</h3>
            <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
            <input
              required
              type="date"
              value={form.holiday_date}
              onChange={e => setForm(f => ({ ...f, holiday_date: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
            <input
              required
              placeholder="e.g. Dashain"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
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
                {saving ? 'Saving…' : 'Add holiday'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
