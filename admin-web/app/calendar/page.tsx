'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import MonthCalendar from '@/components/MonthCalendar';
import AttendanceReportTable from '@/components/AttendanceReportTable';
import Badge from '@/components/Badge';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  resolveShiftForDate,
  type DailyShiftByDate,
} from '@/lib/shift';
import type { AttendanceLog, Employee, LeaveRequest, Shift } from '@/lib/types';

const WINDOW_DAYS = 400;

/** Every AD date key (YYYY-MM-DD) from start to end, inclusive — mirrors
 * my-calendar/page.tsx's datesBetween(). Both bounds are already plain
 * dates (Postgres `date` columns), so this stays local-date arithmetic. */
function datesBetween(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const last = new Date(ey, em - 1, ed);
  const dates: string[] = [];
  for (let d = new Date(sy, sm - 1, sd); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return dates;
}

type CardKey = 'hours' | 'late' | 'early' | 'overtime' | 'present' | 'absent';
type CardEntry = { date: string; minutes: number };

const CARD_STYLES: Record<CardKey, { label: string; hint: string; bg: string; numberText: string; hintText: string }> = {
  hours: { label: 'Total Work Hours', hint: 'This month', bg: 'bg-good-bg', numberText: 'text-good-text', hintText: 'text-good-text/70' },
  late: { label: 'Late In', hint: 'Days this month', bg: 'bg-warning-bg', numberText: 'text-warning-text', hintText: 'text-warning-text/70' },
  early: { label: 'Early Out', hint: 'Days this month', bg: 'bg-critical-bg', numberText: 'text-critical-text', hintText: 'text-critical-text/70' },
  overtime: { label: 'Overtime', hint: 'This month', bg: 'bg-info-bg', numberText: 'text-info-text', hintText: 'text-info-text/70' },
  present: { label: 'Present Days', hint: 'This month', bg: 'bg-accent/10', numberText: 'text-accent', hintText: 'text-accent/70' },
  absent: { label: 'Absent Days', hint: 'No attendance logs', bg: 'bg-critical-bg', numberText: 'text-critical-text', hintText: 'text-critical-text/70' },
};

export default function CalendarPage() {
  const { system } = useCalendarSystem();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<AttendanceLog[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [visibleDates, setVisibleDates] = useState<string[]>([]);
  const [expandedCard, setExpandedCard] = useState<CardKey | null>(null);
  const [selectedTab, setSelectedTab] = useState<'day' | 'leave'>('day');

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => {
        setEmployees(data ?? []);
        if (data && data.length > 0) setEmployeeId(data[0].id);
      });
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    setSelectedDate(null);
    setExpandedCard(null);
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('punch_time', since)
      .order('punch_time', { ascending: true })
      .then(({ data }) => setLogs(data ?? []));
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .then(({ data }) => setLeaveRequests(data ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('work_date, shift_id')
      .eq('employee_id', employeeId)
      .gte('work_date', since.slice(0, 10))
      .then(({ data }) => setDailyShiftRows(data ?? []));
  }, [employeeId]);

  const employee = useMemo(() => employees.find(e => e.id === employeeId) ?? null, [employees, employeeId]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    if (!employeeId) return map;
    const perDate = new Map<string, string | null>();
    for (const r of dailyShiftRows) perDate.set(r.work_date, r.shift_id);
    map.set(employeeId, perDate);
    return map;
  }, [dailyShiftRows, employeeId]);

  const dayStatus = useMemo(() => {
    const byDate = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const key = localDateKey(log.punch_time);
      const list = byDate.get(key);
      if (list) list.push(log);
      else byDate.set(key, [log]);
    }
    const map = new Map<string, ReturnType<typeof computeDayStatusForResolvedShift>>();
    if (!employee) return map;
    applyOvernightShiftCorrection(byDate, logs, employee, shifts, dailyShiftByDate);
    for (const [date, dayLogs] of byDate) {
      const resolved = resolveShiftForDate(employee, shifts, date, dailyShiftByDate);
      map.set(date, computeDayStatusForResolvedShift(dayLogs, resolved));
    }
    return map;
  }, [logs, employee, shifts, dailyShiftByDate]);

  const leaveByDate = useMemo(() => {
    const map = new Map<string, LeaveRequest>();
    for (const lr of leaveRequests) {
      for (const date of datesBetween(lr.start_date, lr.end_date)) map.set(date, lr);
    }
    return map;
  }, [leaveRequests]);

  const leaveDates = useMemo(() => new Set(leaveByDate.keys()), [leaveByDate]);

  const weekOffDates = useMemo(() => {
    const set = new Set<string>();
    if (!employeeId) return set;
    const perDate = dailyShiftByDate.get(employeeId);
    if (!perDate) return set;
    for (const [date, shiftId] of perDate) {
      if (shiftId === null) set.add(date);
    }
    return set;
  }, [dailyShiftByDate, employeeId]);

  const monthSummary = useMemo(() => {
    const hours: CardEntry[] = [];
    const late: CardEntry[] = [];
    const early: CardEntry[] = [];
    const overtime: CardEntry[] = [];
    const present: CardEntry[] = [];
    const absent: CardEntry[] = [];
    let totalWorkMinutes = 0;
    let overtimeMinutes = 0;
    const todayKey = localDateKey(new Date().toISOString());

    for (const date of visibleDates) {
      const status = dayStatus.get(date);
      if (status) {
        present.push({ date, minutes: 0 });
        if (status.hasOut) {
          hours.push({ date, minutes: status.totalMinutes });
          totalWorkMinutes += status.totalMinutes;
        }
        if (status.isLate) late.push({ date, minutes: status.lateMinutes });
        if (status.isEarly) early.push({ date, minutes: status.earlyMinutes });
        if (status.overtimeMinutes > 0) {
          overtime.push({ date, minutes: status.overtimeMinutes });
          overtimeMinutes += status.overtimeMinutes;
        }
      } else if (date <= todayKey && !leaveDates.has(date) && !weekOffDates.has(date)) {
        absent.push({ date, minutes: 0 });
      }
    }
    const byDateDesc = (a: CardEntry, b: CardEntry) => b.date.localeCompare(a.date);
    return {
      totalWorkMinutes,
      overtimeMinutes,
      entries: {
        hours: hours.sort(byDateDesc),
        late: late.sort(byDateDesc),
        early: early.sort(byDateDesc),
        overtime: overtime.sort(byDateDesc),
        present: present.sort(byDateDesc),
        absent: absent.sort(byDateDesc),
      } satisfies Record<CardKey, CardEntry[]>,
    };
  }, [visibleDates, dayStatus, leaveDates, weekOffDates]);

  const selectedLeave = selectedDate ? leaveByDate.get(selectedDate) ?? null : null;

  const selectedDaySummary = useMemo(() => {
    if (dayLogs.length === 0 || !employee || !selectedDate) return null;
    const resolved = resolveShiftForDate(employee, shifts, selectedDate, dailyShiftByDate);
    return computeDayStatusForResolvedShift(dayLogs, resolved);
  }, [dayLogs, employee, shifts, selectedDate, dailyShiftByDate]);

  useEffect(() => {
    if (!selectedDate || !employeeId) {
      setDayLogs([]);
      return;
    }
    setDayLoading(true);
    const start = `${selectedDate}T00:00:00`;
    const end = new Date(new Date(start).getTime() + 86400000).toISOString();
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('punch_time', start)
      .lt('punch_time', end)
      .order('punch_time', { ascending: true })
      .then(({ data }) => {
        setDayLogs(data ?? []);
        setDayLoading(false);
      });
  }, [selectedDate, employeeId]);

  function cardValue(key: CardKey) {
    if (key === 'hours') return formatHoursMinutes(monthSummary.totalWorkMinutes);
    if (key === 'overtime') return formatHoursMinutes(monthSummary.overtimeMinutes);
    const count = monthSummary.entries[key].length;
    return `${count} day${count === 1 ? '' : 's'}`;
  }

  return (
    <AppShell title="Attendance Calendar">
      <div className="mb-3 flex w-fit items-center gap-2.5 rounded-xl border border-slate-200 bg-white py-1.5 pl-1.5 pr-3 shadow-sm">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <UserIcon className="h-4 w-4" />
        </span>
        <div className="flex flex-col">
          <label className="text-[10px] font-semibold uppercase leading-none tracking-wide text-slate-400">Employee</label>
          <select
            value={employeeId}
            onChange={e => setEmployeeId(e.target.value)}
            className="max-w-[16rem] bg-transparent text-sm font-semibold text-ink focus:outline-none"
          >
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.keys(CARD_STYLES) as CardKey[]).map(key => {
            const style = CARD_STYLES[key];
            const open = expandedCard === key;
            return (
              <button
                key={key}
                onClick={() => setExpandedCard(open ? null : key)}
                className={`rounded-xl p-3 text-left shadow-sm ring-2 transition-shadow ${style.bg} ${
                  open ? 'ring-accent' : 'ring-transparent hover:ring-slate-200'
                }`}
              >
                <div className={`text-lg font-bold sm:text-xl ${style.numberText}`}>{cardValue(key)}</div>
                <div className="mt-0.5 text-xs font-semibold text-ink">{style.label}</div>
                <div className={`text-[11px] ${style.hintText}`}>{style.hint}</div>
              </button>
            );
          })}
        </div>

        {expandedCard && (
          <div className="mt-2.5 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-semibold text-ink">{CARD_STYLES[expandedCard].label} this month</h3>
            {monthSummary.entries[expandedCard].length === 0 ? (
              <p className="text-sm text-slate-400">Nothing to show for this month.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {monthSummary.entries[expandedCard].map(entry => {
                  const day = dayStatus.get(entry.date);
                  return (
                    <div key={entry.date} className="py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-ink">{formatAdDate(entry.date, system)}</span>
                        {!day && <Badge tone="critical">Absent</Badge>}
                        {day?.isLate && <Badge tone="warning">Late</Badge>}
                      </div>
                      {day && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span>
                            IN {new Date(day.checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span>
                            OUT{' '}
                            {day.checkOut
                              ? new Date(day.checkOut.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : '–:–'}
                          </span>
                          {day.isLate && <span className="text-warning-text">Late {formatHoursMinutes(day.lateMinutes)}</span>}
                          {day.isEarly && <span className="text-critical-text">Early {formatHoursMinutes(day.earlyMinutes)}</span>}
                          <span>{formatHoursMinutes(day.totalMinutes)}</span>
                          {day.overtimeMinutes > 0 && (
                            <span className="text-info-text">OT {formatHoursMinutes(day.overtimeMinutes)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <MonthCalendar
          dayStatus={dayStatus}
          leaveDates={leaveDates}
          weekOffDates={weekOffDates}
          selectedDate={selectedDate}
          onSelectDate={d => {
            setSelectedDate(d);
            setSelectedTab('day');
          }}
          onMonthChange={setVisibleDates}
        />

        <div>
        <div className="mb-3 inline-flex gap-1 rounded-lg border border-slate-200 bg-white p-1 text-sm font-semibold shadow-sm">
          <button
            onClick={() => setSelectedTab('day')}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              selectedTab === 'day' ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            Day Detail
          </button>
          <button
            onClick={() => setSelectedTab('leave')}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              selectedTab === 'leave' ? 'bg-accent text-white' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            Recent Leave
          </button>
        </div>

        {selectedTab === 'day' && !selectedDate && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-400">Pick a day on the calendar to see its detail.</p>
          </div>
        )}

        {selectedTab === 'day' && selectedDate && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold text-ink">{formatAdDate(selectedDate, system)}</h2>
            {selectedLeave && (
              <div className="mb-3 rounded-xl bg-purple-100 p-3">
                <div className="text-xs font-medium text-purple-700">On Leave</div>
                <div className="text-base font-bold capitalize text-ink">{selectedLeave.leave_type}</div>
              </div>
            )}
            {dayLoading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : !selectedDaySummary ? (
              !selectedLeave && <p className="text-sm text-slate-400">No punches recorded.</p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-good-bg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium text-good-text">IN</div>
                        <div className="text-base font-bold text-ink">
                          {new Date(selectedDaySummary.checkIn.punch_time).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        <div className="text-xs capitalize text-slate-500">{selectedDaySummary.checkIn.method}</div>
                      </div>
                      {selectedDaySummary.isLate && (
                        <Badge tone="warning">Late by {formatHoursMinutes(selectedDaySummary.lateMinutes)}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl bg-warning-bg p-3">
                    {selectedDaySummary.checkOut ? (
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium text-warning-text">OUT</div>
                          <div className="text-base font-bold text-ink">
                            {new Date(selectedDaySummary.checkOut.punch_time).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                          <div className="text-xs capitalize text-slate-500">{selectedDaySummary.checkOut.method}</div>
                        </div>
                        {selectedDaySummary.isEarly && (
                          <Badge tone="critical">Early by {formatHoursMinutes(selectedDaySummary.earlyMinutes)}</Badge>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="text-xs font-medium text-warning-text">OUT</div>
                        <div className="text-sm text-slate-400">Not yet</div>
                      </>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-good-bg p-3">
                    <div className="text-xs font-medium text-good-text">Total Work Hours</div>
                    <div className="text-base font-bold text-ink">{formatHoursMinutes(selectedDaySummary.totalMinutes)}</div>
                  </div>
                  <div className="rounded-xl bg-info-bg p-3">
                    <div className="text-xs font-medium text-info-text">Overtime</div>
                    <div className="text-base font-bold text-ink">{formatHoursMinutes(selectedDaySummary.overtimeMinutes)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {selectedTab === 'leave' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink">Recent Leave</h3>
            {leaveRequests.length === 0 ? (
              <p className="text-sm text-slate-400">No approved leave on record.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {[...leaveRequests]
                  .sort((a, b) => b.start_date.localeCompare(a.start_date))
                  .map(lr => (
                    <div key={lr.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="text-sm text-ink">
                        {formatAdDate(lr.start_date, system)}
                        {lr.start_date !== lr.end_date && <> – {formatAdDate(lr.end_date, system)}</>}
                      </div>
                      <Badge tone="info">{lr.leave_type}</Badge>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        </div>
      </div>

      <div className="mt-4">
        <h2 className="mb-2 text-sm font-semibold text-ink">Attendance Report</h2>
        <AttendanceReportTable />
      </div>
    </AppShell>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}
