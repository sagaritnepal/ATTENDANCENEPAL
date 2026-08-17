'use client';

import { useEffect, useMemo, useState } from 'react';
import NepaliDate from 'nepali-date-converter';
import { supabase } from '@/lib/supabase';
import Avatar from '@/components/Avatar';
import { buildMonth, monthDateRange, stepWeek, weekRange, type CalendarAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Employee, Shift } from '@/lib/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Two sentinel cell values, distinct from any real shift_id: "no row for
 * this cell at all" (falls back to the employee's normal shift) vs. "an
 * explicit Week Off row" (shift_id stored as null) — see employee_daily_shifts'
 * design (20260806100000_employee_daily_shifts.sql). */
const UNSET = 'unset';
const WEEK_OFF_VALUE = 'week-off';

type RosterRow = { employee_id: string; work_date: string; shift_id: string | null };

function shortDate(date: string) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

function shortBsDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return NepaliDate.fromAD(new Date(y, m - 1, d)).format('D/M');
}

/** The Sun-Sat week structure itself always stays AD (see weekRange's own
 * comment — the duty roster is filled in real calendar weeks regardless of
 * display system), but the label shown to the user should still follow the
 * global AD/BS switch like every other date on the page, rather than being
 * silently stuck on AD forever. */
function bsWeekLabel(startKey: string, endKey: string): string {
  const [sy, sm, sd] = startKey.split('-').map(Number);
  const [ey, em, ed] = endKey.split('-').map(Number);
  const bsStart = NepaliDate.fromAD(new Date(sy, sm - 1, sd));
  const bsEnd = NepaliDate.fromAD(new Date(ey, em - 1, ed));
  const startLabel = bsStart.getYear() === bsEnd.getYear() ? bsStart.format('D MMMM') : bsStart.format('D MMMM YYYY');
  return `${startLabel} – ${bsEnd.format('D MMMM YYYY')}`;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

function parseAdKey(value: string): CalendarAnchor {
  const [y, m, d] = value.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

function weekdayOf(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

export default function WeeklyRosterGrid() {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(todayIso);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  // "employeeId|date" -> a real shift_id, WEEK_OFF_VALUE, or UNSET — staged
  // here until Save is clicked, not written on every pick.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);

  const week = useMemo(() => weekRange(anchor), [anchor]);
  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);
  const shiftById = useMemo(() => new Map(templateShifts.map(s => [s.id, s])), [templateShifts]);
  const today = todayIso();

  // "The month" this bulk-copy fills the rest of — anchored to the middle
  // of the displayed week (Wednesday), not its first day. A Sun-Sat week
  // straddling a month boundary (very common in BS, whose months rarely
  // land on week boundaries) would otherwise anchor to whichever month is
  // about to end in a day or two, leaving almost nothing left to copy into.
  const monthAnchor = useMemo(() => parseAdKey(week.dates[3]), [week.dates]);
  const monthRange = useMemo(() => monthDateRange(system, monthAnchor), [system, monthAnchor]);
  const monthLabel = useMemo(() => buildMonth(system, monthAnchor).label, [system, monthAnchor]);
  const remainingDates = useMemo(() => {
    const weekSet = new Set(week.dates);
    const out: string[] = [];
    const cur = new Date(monthRange.start + 'T00:00:00Z');
    const end = new Date(monthRange.end + 'T00:00:00Z');
    while (cur <= end) {
      const key = cur.toISOString().slice(0, 10);
      if (!weekSet.has(key)) out.push(key);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }, [monthRange, week.dates]);

  function reload() {
    setLoading(true);
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active').order('name'),
      supabase.from('shifts').select('*'),
      supabase
        .from('employee_daily_shifts')
        .select('employee_id, work_date, shift_id')
        .gte('work_date', week.start)
        .lte('work_date', week.end),
    ]).then(([empRes, shiftsRes, rosterRes]) => {
      setEmployees(empRes.data ?? []);
      setShifts(shiftsRes.data ?? []);
      setRosterRows(rosterRes.data ?? []);
      setLoading(false);
    });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [week.start, week.end]);

  useEffect(() => {
    setPending({});
    setSaveError(null);
  }, [week.start]);

  function currentValue(employeeId: string, date: string): string {
    const key = `${employeeId}|${date}`;
    if (key in pending) return pending[key];
    const row = rosterRows.find(r => r.employee_id === employeeId && r.work_date === date);
    if (!row) return UNSET;
    return row.shift_id === null ? WEEK_OFF_VALUE : row.shift_id;
  }

  function setCell(employeeId: string, date: string, value: string) {
    setPending(p => ({ ...p, [`${employeeId}|${date}`]: value }));
  }

  // Stages the week's first day's pick onto every other day in that row —
  // still just pending until Save, same as a manual pick on each day.
  function copyRowToAll(employeeId: string) {
    const sourceValue = currentValue(employeeId, week.dates[0]);
    if (sourceValue === UNSET) return;
    setPending(p => {
      const next = { ...p };
      for (const date of week.dates.slice(1)) next[`${employeeId}|${date}`] = sourceValue;
      return next;
    });
  }

  const pendingCount = Object.keys(pending).length;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    const toUpsert: { employee_id: string; work_date: string; shift_id: string | null }[] = [];
    const toDelete: { employee_id: string; work_date: string }[] = [];
    for (const [key, value] of Object.entries(pending)) {
      const [employeeId, date] = key.split('|');
      if (value === UNSET) toDelete.push({ employee_id: employeeId, work_date: date });
      else toUpsert.push({ employee_id: employeeId, work_date: date, shift_id: value === WEEK_OFF_VALUE ? null : value });
    }

    if (toUpsert.length > 0) {
      const { error } = await supabase.from('employee_daily_shifts').upsert(toUpsert, { onConflict: 'employee_id,work_date' });
      if (error) {
        setSaving(false);
        setSaveError(error.message);
        return;
      }
    }
    for (const d of toDelete) {
      const { error } = await supabase
        .from('employee_daily_shifts')
        .delete()
        .eq('employee_id', d.employee_id)
        .eq('work_date', d.work_date);
      if (error) {
        setSaving(false);
        setSaveError(error.message);
        return;
      }
    }

    setSaving(false);
    setPending({});
    reload();
  }

  // Takes this week's Sun-Sat pattern (per employee, including anything
  // still pending here) and writes it into every remaining day of the month
  // it falls in, matched by weekday — Monday this week's pick lands on
  // every other Monday left in the month, and so on. Only days where the
  // source week actually has a pick propagate; an employee's untouched (—)
  // weekday leaves whatever's already on the target days alone rather than
  // clearing it. Writes straight to the database (there's nothing to stage
  // — every date it touches is outside this grid, so Save/Cancel above
  // can't cover it), which is why it gets its own confirm step instead.
  async function performCopyToMonth() {
    setCopying(true);
    setCopyError(null);
    const upserts: { employee_id: string; work_date: string; shift_id: string | null }[] = [];
    for (const emp of employees) {
      const byWeekday = new Map<number, string | null>();
      week.dates.forEach((date, i) => {
        const value = currentValue(emp.id, date);
        if (value !== UNSET) byWeekday.set(i, value === WEEK_OFF_VALUE ? null : value);
      });
      if (byWeekday.size === 0) continue;
      for (const date of remainingDates) {
        const wd = byWeekday.get(weekdayOf(date));
        if (wd !== undefined) upserts.push({ employee_id: emp.id, work_date: date, shift_id: wd });
      }
    }
    if (upserts.length === 0) {
      setCopying(false);
      setCopyModalOpen(false);
      return;
    }
    const { error } = await supabase.from('employee_daily_shifts').upsert(upserts, { onConflict: 'employee_id,work_date' });
    setCopying(false);
    if (error) {
      setCopyError(error.message);
      return;
    }
    // Every written date is outside the currently displayed week (see
    // remainingDates), so nothing on screen changes — no need to touch
    // rosterRows or reload for a view that can't show those dates anyway.
    setCopyModalOpen(false);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 3000);
  }

  const copyCandidateCount = useMemo(
    () => employees.filter(emp => week.dates.some(date => currentValue(emp.id, date) !== UNSET)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees, week.dates, rosterRows, pending]
  );

  function cellTone(value: string, dirty: boolean) {
    if (dirty) return 'border-accent bg-accent/10 text-ink font-medium';
    if (value === WEEK_OFF_VALUE) return 'border-warning/30 bg-warning-bg text-warning-text font-semibold';
    if (value === UNSET) return 'border-slate-200 text-slate-400';
    return 'border-accent/30 bg-accent/5 text-ink font-medium';
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setAnchor(stepWeek(anchor, -1))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50">
            ←
          </button>
          <span className="text-sm font-semibold text-ink">
            {system === 'AD' ? week.label : bsWeekLabel(week.start, week.end)}
          </span>
          <button onClick={() => setAnchor(stepWeek(anchor, 1))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50">
            →
          </button>
        </div>
        <div className="flex items-center gap-3">
          {copyDone && <span className="text-xs font-semibold text-good-text">✓ Copied to rest of {monthLabel}</span>}
          <button
            type="button"
            onClick={() => setCopyModalOpen(true)}
            disabled={copyCandidateCount === 0 || remainingDates.length === 0 || pendingCount > 0}
            title={
              pendingCount > 0
                ? 'Save this week’s changes first'
                : remainingDates.length === 0
                  ? 'This week already covers the whole month'
                  : undefined
            }
            className="rounded-md border border-accent/30 bg-white px-2.5 py-1.5 text-xs font-semibold text-accent shadow-sm hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⧉ Copy this week to rest of {monthLabel}
          </button>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {loading ? (
          <p className="text-center text-sm text-slate-400">Loading…</p>
        ) : employees.length === 0 ? (
          <p className="text-center text-sm text-slate-400">No active employees.</p>
        ) : templateShifts.length === 0 ? (
          <p className="text-center text-sm text-slate-400">
            Create at least one shift above first (e.g. Day Duty, Night Duty, Day &amp; Night Duty) — this roster assigns one of
            those to each employee per day.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-2.5 font-medium">Employee</th>
                  {week.dates.map((date, i) => (
                    <th key={date} className={`whitespace-nowrap px-1.5 py-2.5 text-center font-medium ${date === today ? 'bg-accent/10 text-accent' : ''}`}>
                      {WEEKDAY_LABELS[i]}
                      <div className="text-[10px] font-normal normal-case text-slate-400">
                        {system === 'AD' ? (
                          <>
                            {shortDate(date)} <span className="text-slate-300">·</span> {shortBsDate(date)}
                          </>
                        ) : (
                          <>
                            {shortBsDate(date)} <span className="text-slate-300">·</span> {shortDate(date)}
                          </>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, i) => {
                  const rowBg = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                  return (
                    <tr key={emp.id} className="border-b border-slate-100 last:border-0">
                      <td className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2 ${rowBg}`}>
                        <div className="flex items-center gap-2">
                          <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-14 w-14 text-base" />
                          <span className="truncate font-medium text-ink">{emp.name}</span>
                          <button
                            type="button"
                            onClick={() => copyRowToAll(emp.id)}
                            disabled={currentValue(emp.id, week.dates[0]) === UNSET}
                            title="Copy the first day's pick to every day this week"
                            className="ml-1 shrink-0 rounded-md border border-slate-200 px-1.5 py-1 text-[10px] font-semibold text-slate-500 hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ⧉ Copy all
                          </button>
                        </div>
                      </td>
                      {week.dates.map(date => {
                        const value = currentValue(emp.id, date);
                        const dirty = `${emp.id}|${date}` in pending;
                        return (
                          <td key={date} className={`px-1 py-1.5 text-center ${date === today ? 'bg-accent/5' : rowBg}`}>
                            <select
                              value={value}
                              onChange={e => setCell(emp.id, date, e.target.value)}
                              title={shiftById.get(value)?.name}
                              className={`w-full rounded-md border px-1 py-1 text-xs shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-accent/30 ${cellTone(
                                value,
                                dirty
                              )}`}
                            >
                              <option value={UNSET}>—</option>
                              <option value={WEEK_OFF_VALUE}>Week Off</option>
                              {templateShifts.map(s => (
                                <option key={s.id} value={s.id}>
                                  {s.name} ({s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)})
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {saveError && <p className="mt-3 text-sm text-critical">Could not save: {saveError}</p>}

        {pendingCount > 0 && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
            <span className="text-sm font-medium text-ink">
              {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPending({})} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        )}
      </div>

      {copyModalOpen && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-2 text-lg font-semibold text-ink">Copy this week to the rest of {monthLabel}?</h3>
            <p className="mb-4 text-sm text-slate-600">
              {copyCandidateCount} employee{copyCandidateCount === 1 ? '' : 's'} with a pick this week will get that same
              Sun–Sat pattern applied to every other day in {monthLabel} ({remainingDates.length} day
              {remainingDates.length === 1 ? '' : 's'}), matched by weekday. A day this week left blank (—) leaves any
              existing pick on the matching days untouched — this only fills in, it never clears. You can still hand-edit
              any single day afterward.
            </p>
            {copyError && <p className="mb-3 text-sm text-critical">Could not copy: {copyError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCopyModalOpen(false)}
                disabled={copying}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={performCopyToMonth}
                disabled={copying}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {copying ? 'Copying…' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
