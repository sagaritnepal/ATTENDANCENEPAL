'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Avatar from '@/components/Avatar';
import { buildMonth, stepAnchor, todayAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { Employee, Shift } from '@/lib/types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Two sentinel cell values, distinct from any real shift_id: "no row for
 * this cell at all" (falls back to the employee's normal shift) vs. "an
 * explicit Week Off row" (shift_id stored as null) — same convention
 * WeeklyRosterGrid uses, see employee_daily_shifts' design
 * (20260806100000_employee_daily_shifts.sql). */
const UNSET = 'unset';
const WEEK_OFF_VALUE = 'week-off';

type RosterRow = { employee_id: string; work_date: string; shift_id: string | null };

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Same grid/data model as WeeklyRosterGrid (employee_daily_shifts, one exact
 * date per column) just spanning a whole AD/BS month instead of one week —
 * filling in a month of exceptions (someone covering nights all month, a
 * rotating crew, etc.) without paging through 4-5 separate weeks. */
export default function MonthlyRosterGrid() {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(todayAnchor);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  // "employeeId|date" -> a real shift_id, WEEK_OFF_VALUE, or UNSET — staged
  // here until Save is clicked, not written on every pick.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const monthCells = useMemo(() => month.weeks.flat().filter(c => c.inMonth), [month]);
  const dates = useMemo(() => monthCells.map(c => c.adKey), [monthCells]);
  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);
  const shiftById = useMemo(() => new Map(templateShifts.map(s => [s.id, s])), [templateShifts]);
  const today = todayIso();

  function reload() {
    if (dates.length === 0) return;
    setLoading(true);
    const start = dates[0];
    const end = dates[dates.length - 1];
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active').order('name'),
      supabase.from('shifts').select('*'),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', start).lte('work_date', end),
    ]).then(([empRes, shiftsRes, rosterRes]) => {
      setEmployees(empRes.data ?? []);
      setShifts(shiftsRes.data ?? []);
      setRosterRows(rosterRes.data ?? []);
      setLoading(false);
    });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, [dates.join(',')]);

  useEffect(() => {
    setPending({});
    setSaveError(null);
  }, [dates.join(',')]);

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

  // Stages the month's first day's pick onto every other day in that row —
  // still just pending until Save, same as a manual pick on each day.
  function copyRowToAll(employeeId: string) {
    const sourceValue = currentValue(employeeId, dates[0]);
    if (sourceValue === UNSET) return;
    setPending(p => {
      const next = { ...p };
      for (const date of dates.slice(1)) next[`${employeeId}|${date}`] = sourceValue;
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
          <button onClick={() => setAnchor(a => stepAnchor(system, a, -1))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50">
            ←
          </button>
          <span className="text-sm font-semibold text-ink">{month.label}</span>
          <button onClick={() => setAnchor(a => stepAnchor(system, a, 1))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-500 shadow-sm hover:bg-slate-50">
            →
          </button>
          <button onClick={() => setAnchor(todayAnchor())} className="text-xs font-medium text-accent hover:underline">
            Today
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
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-2.5 font-medium">Employee</th>
                  {monthCells.map(cell => (
                    <th key={cell.adKey} className={`whitespace-nowrap px-1 py-2.5 text-center font-medium ${cell.adKey === today ? 'bg-accent/10 text-accent' : ''}`}>
                      {WEEKDAY_LABELS[new Date(cell.adKey + 'T00:00:00Z').getUTCDay()]}
                      <div className="text-[11px] font-normal normal-case text-slate-400">{cell.displayDay}</div>
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
                          <Avatar name={emp.name} photoUrl={emp.profile_photo_url} className="h-12 w-12 text-sm" />
                          <span className="truncate font-medium text-ink">{emp.name}</span>
                          <button
                            type="button"
                            onClick={() => copyRowToAll(emp.id)}
                            disabled={currentValue(emp.id, dates[0]) === UNSET}
                            title="Copy the first day's pick to every day this month"
                            className="ml-1 shrink-0 rounded-md border border-slate-200 px-1.5 py-1 text-[10px] font-semibold text-slate-500 hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            ⧉ Copy all
                          </button>
                        </div>
                      </td>
                      {dates.map(date => {
                        const value = currentValue(emp.id, date);
                        const dirty = `${emp.id}|${date}` in pending;
                        return (
                          <td key={date} className={`px-0.5 py-1.5 text-center ${date === today ? 'bg-accent/5' : rowBg}`}>
                            <select
                              value={value}
                              onChange={e => setCell(emp.id, date, e.target.value)}
                              title={
                                shiftById.get(value)
                                  ? `${shiftById.get(value)!.name} (${shiftById.get(value)!.start_time.slice(0, 5)}–${shiftById
                                      .get(value)!
                                      .end_time.slice(0, 5)})`
                                  : undefined
                              }
                              className={`w-24 rounded-md border px-1 py-1 text-[11px] shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-accent/30 ${cellTone(
                                value,
                                dirty
                              )}`}
                            >
                              <option value={UNSET}>—</option>
                              <option value={WEEK_OFF_VALUE}>Week Off</option>
                              {templateShifts.map(s => (
                                <option key={s.id} value={s.id}>
                                  {s.name} {s.start_time.slice(0, 2)}-{s.end_time.slice(0, 2)}
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
    </div>
  );
}
