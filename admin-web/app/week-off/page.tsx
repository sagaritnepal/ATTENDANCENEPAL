'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import DatePicker from '@/components/DatePicker';
import { useConfirm } from '@/components/ConfirmDialog';
import { buildMonth, formatAdDate, stepAnchor, todayAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { nepalTodayIso } from '@/lib/shift';
import { datesInRange, upcomingHolidays } from '@/lib/nepalHolidays';
import type { CompanyHoliday } from '@/lib/types';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// holiday_end_date only travels with the form while a predefined multi-day
// pick (Dashain, Tihar, ...) is active — it's what makes handleAddHoliday
// write one row per day in the range instead of just holiday_date. It's
// blanked back out the moment the date is hand-edited away from that pick's
// start day, or the name no longer matches a predefined entry at all.
const EMPTY_FORM = { holiday_date: '', holiday_end_date: '', name: '' };

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
  const { system } = useCalendarSystem();
  const confirm = useConfirm();
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [anchor, setAnchor] = useState(todayAnchor);

  function reload() {
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

  const holidaysByDate = useMemo(() => {
    const map = new Map<string, CompanyHoliday>();
    for (const h of holidays) map.set(h.holiday_date, h);
    return map;
  }, [holidays]);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);

  // "Today" for the predefined-holiday suggestions, re-checked once a day
  // rather than only read once at mount — an admin panel left open for
  // multiple days would otherwise keep suggesting a holiday that already
  // passed until the page is manually reloaded. This same daily recheck is
  // also what carries the suggestions over to a new BS year automatically
  // once one starts (upcomingHolidays() resolves the BS year from `today`
  // itself, see lib/nepalHolidays.ts) — no separate year-rollover logic
  // needed here.
  const [today, setToday] = useState(nepalTodayIso);
  useEffect(() => {
    const id = setInterval(() => setToday(nepalTodayIso()), 24 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Suggestions for the Name field's datalist — every predefined Nepal
  // public holiday whose last day hasn't passed yet, soonest first.
  const upcoming = useMemo(() => upcomingHolidays(today), [today]);
  const predefinedByName = useMemo(() => new Map(upcoming.map(h => [h.name, h])), [upcoming]);

  async function handleAddHoliday(e: React.FormEvent) {
    e.preventDefault();
    if (!form.holiday_date || !form.name.trim()) return;
    setSaving(true);
    const name = form.name.trim();
    // A predefined multi-day pick (Dashain, Tihar, ...) writes one row per
    // day in its range, all sharing the same name — a plain single-day pick
    // (custom name, or a predefined one-day holiday) is just the one row,
    // same as before. Upsert instead of insert either way: clicking an
    // already-marked calendar day pre-fills its date, so re-submitting that
    // day renames it instead of hitting the (company_id, holiday_date)
    // unique constraint.
    const dates =
      form.holiday_end_date && form.holiday_end_date > form.holiday_date
        ? datesInRange(form.holiday_date, form.holiday_end_date)
        : [form.holiday_date];
    const { error } = await supabase
      .from('company_holidays')
      .upsert(
        dates.map(holiday_date => ({ holiday_date, name })),
        { onConflict: 'company_id,holiday_date' }
      );
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
    if (!(await confirm('Delete this holiday?', { title: 'Delete holiday?', confirmLabel: 'Delete', tone: 'danger' }))) return;
    const { error } = await supabase.from('company_holidays').delete().eq('id', id);
    if (error) alert(`Couldn't delete: ${error.message}`);
    reload();
  }

  return (
    <AppShell title="Holidays">
      <p className="mb-5 max-w-2xl text-sm text-slate-500">
        Company-wide holiday dates — applies to every employee at once and is treated as a paid day in Payroll.
        Distinct from assigning one employee a Week Off on the Shifts page&apos;s Weekly Roster.
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setAnchor(a => stepAnchor(system, a, -1))}
              className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-ink">{month.label}</span>
            <button
              type="button"
              onClick={() => setAnchor(a => stepAnchor(system, a, 1))}
              className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
            {WEEKDAY_LABELS.map(w => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {month.weeks.flat().map((cell, i) => {
              const holiday = holidaysByDate.get(cell.adKey);
              return (
                <button
                  key={`${cell.adKey}-${i}`}
                  type="button"
                  disabled={!cell.inMonth}
                  title={holiday?.name}
                  onClick={() => {
                    setForm({ holiday_date: cell.adKey, holiday_end_date: '', name: holiday?.name ?? '' });
                    setShowForm(true);
                  }}
                  className={`flex h-9 w-9 flex-col items-center justify-center rounded-lg text-xs transition-colors ${
                    !cell.inMonth
                      ? 'cursor-default text-slate-300'
                      : holiday
                        ? 'bg-accent font-semibold text-white hover:bg-accent/90'
                        : cell.isToday
                          ? 'bg-accent/10 font-semibold text-accent hover:bg-accent/20'
                          : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {cell.displayDay}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setAnchor(todayAnchor())}
            className="mt-3 w-full text-center text-[11px] font-medium text-accent hover:underline"
          >
            Back to today
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
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
                    <td className="whitespace-nowrap py-2.5 pr-4 text-slate-600">{formatAdDate(h.holiday_date, system)}</td>
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
      </div>

      {showForm && (() => {
        const editingExisting = holidaysByDate.has(form.holiday_date);
        return (
          <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
            <form onSubmit={handleAddHoliday} className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
              <h3 className="mb-4 text-lg font-semibold text-ink">{editingExisting ? 'Edit Holiday' : 'New Holiday'}</h3>
              <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
              <input
                required
                list="predefined-holidays-2083"
                placeholder="e.g. Dashain"
                value={form.name}
                onChange={e => {
                  const name = e.target.value;
                  const predefined = predefinedByName.get(name);
                  setForm(f => ({
                    ...f,
                    name,
                    holiday_date: predefined ? predefined.start : f.holiday_date,
                    holiday_end_date: predefined ? predefined.end : '',
                  }));
                }}
                className="mb-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              {/* Suggestions are this year's (BS 2083) government-gazetted public
                  holidays, soonest first — picking one fills in its date (and, for
                  a multi-day festival like Dashain/Tihar, its whole span) below. */}
              <datalist id="predefined-holidays-2083">
                {upcoming.map(h => (
                  <option key={h.name} value={h.name} />
                ))}
              </datalist>
              <p className="mb-3 text-[11px] text-slate-400">Pick a suggestion for this year&apos;s government holidays, or type your own.</p>
              <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
              <div className="mb-1">
                <DatePicker
                  value={form.holiday_date}
                  onChange={v =>
                    setForm(f => ({
                      ...f,
                      holiday_date: v,
                      // Hand-editing the date breaks the link to whatever
                      // predefined range was picked — falls back to a plain
                      // single day instead of silently keeping a stale range.
                      holiday_end_date: predefinedByName.get(f.name)?.start === v ? f.holiday_end_date : '',
                    }))
                  }
                />
              </div>
              {form.holiday_end_date && form.holiday_end_date > form.holiday_date && (
                <p className="mb-3 text-xs font-medium text-accent">
                  Spans {datesInRange(form.holiday_date, form.holiday_end_date).length} days: {formatAdDate(form.holiday_date, system)} –{' '}
                  {formatAdDate(form.holiday_end_date, system)}
                </p>
              )}
              {editingExisting && <p className="mb-3 text-xs text-slate-400">This date already has a holiday — saving will rename it.</p>}
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
                  disabled={saving || !form.holiday_date}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : editingExisting ? 'Save changes' : 'Add holiday'}
                </button>
              </div>
            </form>
          </div>
        );
      })()}
    </AppShell>
  );
}
