'use client';

import { useEffect, useMemo, useState } from 'react';
import NepaliDate from 'nepali-date-converter';
import { supabase } from '@/lib/supabase';
import Avatar from '@/components/Avatar';
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

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function WeeklyRosterGrid() {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(todayIso);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterRows, setRosterRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const week = useMemo(() => weekRange(anchor), [anchor]);
  const templateShifts = useMemo(() => shifts.filter(s => s.employee_id === null), [shifts]);
  const shiftById = useMemo(() => new Map(templateShifts.map(s => [s.id, s])), [templateShifts]);
  const today = todayIso();

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

  function currentValue(employeeId: string, date: string): string {
    const row = rosterRows.find(r => r.employee_id === employeeId && r.work_date === date);
    if (!row) return UNSET;
    return row.shift_id === null ? WEEK_OFF_VALUE : row.shift_id;
  }

  async function handleCellChange(employeeId: string, date: string, value: string) {
    const key = `${employeeId}|${date}`;
    setSavingKey(key);
    setSaveError(null);
    const { error } =
      value === UNSET
        ? await supabase.from('employee_daily_shifts').delete().eq('employee_id', employeeId).eq('work_date', date)
        : await supabase
            .from('employee_daily_shifts')
            .upsert({ employee_id: employeeId, work_date: date, shift_id: value === WEEK_OFF_VALUE ? null : value }, { onConflict: 'employee_id,work_date' });
    setSavingKey(null);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setRosterRows(rows => {
      const rest = rows.filter(r => !(r.employee_id === employeeId && r.work_date === date));
      return value === UNSET ? rest : [...rest, { employee_id: employeeId, work_date: date, shift_id: value === WEEK_OFF_VALUE ? null : value }];
    });
    setFlashKey(key);
    setTimeout(() => setFlashKey(k => (k === key ? null : k)), 900);
  }

  function cellTone(value: string) {
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
        <span className="text-xs text-slate-400">Autosaves as you pick — no separate save step</span>
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
                          <Avatar name={emp.name} />
                          <span className="truncate font-medium text-ink">{emp.name}</span>
                        </div>
                      </td>
                      {week.dates.map(date => {
                        const value = currentValue(emp.id, date);
                        const key = `${emp.id}|${date}`;
                        const isSaving = savingKey === key;
                        const justSaved = flashKey === key;
                        return (
                          <td key={date} className={`px-1 py-1.5 text-center ${date === today ? 'bg-accent/5' : rowBg}`}>
                            <select
                              value={value}
                              disabled={isSaving}
                              onChange={e => handleCellChange(emp.id, date, e.target.value)}
                              title={shiftById.get(value)?.name}
                              className={`w-full rounded-md border px-1 py-1 text-xs shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50 ${cellTone(
                                value
                              )} ${justSaved ? 'ring-2 ring-good' : ''}`}
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
      </div>
    </div>
  );
}
