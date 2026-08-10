'use client';

import { useEffect, useMemo, useState } from 'react';
import NepaliDate from 'nepali-date-converter';
import { supabase } from '@/lib/supabase';
import { stepWeek, weekRange } from '@/lib/calendar';
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

export default function WeeklyRosterGrid() {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 10));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  // "employeeId|date" -> a real shift_id, WEEK_OFF_VALUE, or UNSET.
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const week = useMemo(() => weekRange(anchor), [anchor]);
  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);

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

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-3">
        <button onClick={() => setAnchor(stepWeek(anchor, -1))} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
          ←
        </button>
        <span className="text-sm font-semibold text-ink">
          {system === 'AD' ? week.label : bsWeekLabel(week.start, week.end)}
        </span>
        <button onClick={() => setAnchor(stepWeek(anchor, 1))} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
          →
        </button>
      </div>

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
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-3 py-2 font-medium">Employee</th>
                {week.dates.map((date, i) => (
                  <th key={date} className="whitespace-nowrap px-1.5 py-2 text-center font-medium">
                    {WEEKDAY_LABELS[i]}
                    <div className="text-[10px] font-normal normal-case text-slate-400">
                      {system === 'AD' ? (
                        <>
                          {shortDate(date)} AD <span className="text-slate-300">·</span> {shortBsDate(date)} BS
                        </>
                      ) : (
                        <>
                          {shortBsDate(date)} BS <span className="text-slate-300">·</span> {shortDate(date)} AD
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
                    <td className={`sticky left-0 z-10 whitespace-nowrap px-3 py-2 font-medium text-ink ${rowBg}`}>{emp.name}</td>
                    {week.dates.map(date => {
                      const value = currentValue(emp.id, date);
                      const dirty = `${emp.id}|${date}` in pending;
                      return (
                        <td key={date} className={`px-1 py-1.5 text-center ${rowBg}`}>
                          <select
                            value={value}
                            onChange={e => setCell(emp.id, date, e.target.value)}
                            className={`w-full rounded-md border px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 ${
                              dirty ? 'border-accent bg-accent/5' : value === UNSET ? 'border-slate-200 text-slate-400' : 'border-slate-200'
                            }`}
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

      {saveError && <p className="mt-3 text-sm text-critical">{saveError}</p>}

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
  );
}
