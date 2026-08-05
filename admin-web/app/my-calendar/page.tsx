'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import MonthCalendar from '@/components/MonthCalendar';
import Badge from '@/components/Badge';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { computeDayStatus, formatHoursMinutes, resolveShift } from '@/lib/shift';
import type { AttendanceLog, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';

const WINDOW_DAYS = 400;

/** Every AD date key (YYYY-MM-DD) from start to end, inclusive. Both are
 * already plain dates (Postgres `date` columns), so this stays in local
 * calendar-date arithmetic and never touches a timestamp/timezone. */
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

const CARD_STYLES: Record<CardKey, { label: string; bg: string; text: string }> = {
  hours: { label: 'Total Work Hours', bg: 'bg-good-bg', text: 'text-good-text' },
  late: { label: 'Late In', bg: 'bg-warning-bg', text: 'text-warning-text' },
  early: { label: 'Early Out', bg: 'bg-critical-bg', text: 'text-critical-text' },
  overtime: { label: 'Overtime', bg: 'bg-info-bg', text: 'text-info-text' },
  present: { label: 'Present Days', bg: 'bg-good-bg', text: 'text-good-text' },
  absent: { label: 'Absent Days', bg: 'bg-slate-100', text: 'text-slate-600' },
};

export default function MyCalendarPage() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<AttendanceLog[]>([]);
  const [dayLoading, setDayLoading] = useState(false);
  const [visibleDates, setVisibleDates] = useState<string[]>([]);
  const [expandedCard, setExpandedCard] = useState<CardKey | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (!profile?.employee_id) return;
      setEmployeeId(profile.employee_id);
      const windowStart = new Date(Date.now() - WINDOW_DAYS * 86400000);
      const [{ data: emp }, { data: shiftRows }, { data: rows }, { data: summaryRows }, { data: leaveRows }] = await Promise.all([
        supabase.from('employees').select('*').eq('id', profile.employee_id).single(),
        supabase.from('shifts').select('*'),
        supabase
          .from('attendance_logs')
          .select('*')
          .eq('employee_id', profile.employee_id)
          .gte('punch_time', windowStart.toISOString())
          .order('punch_time', { ascending: true }),
        supabase
          .from('payroll_summaries')
          .select('*')
          .eq('employee_id', profile.employee_id)
          .gte('work_date', windowStart.toISOString().slice(0, 10)),
        supabase.from('leave_requests').select('*').eq('employee_id', profile.employee_id).eq('status', 'approved'),
      ]);
      setEmployee(emp ?? null);
      setShifts(shiftRows ?? []);
      setLogs(rows ?? []);
      setSummaries(summaryRows ?? []);
      setLeaveRequests(leaveRows ?? []);
    });
  }, []);

  const dayStatus = useMemo(() => {
    const byDate = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const key = localDateKey(log.punch_time);
      const list = byDate.get(key);
      if (list) list.push(log);
      else byDate.set(key, [log]);
    }
    const map = new Map<string, ReturnType<typeof computeDayStatus>>();
    if (!employee) return map;
    const shift = resolveShift(employee, shifts);
    for (const [date, dayLogs] of byDate) map.set(date, computeDayStatus(dayLogs, shift));
    return map;
  }, [logs, employee, shifts]);

  const leaveByDate = useMemo(() => {
    const map = new Map<string, LeaveRequest>();
    for (const lr of leaveRequests) {
      for (const date of datesBetween(lr.start_date, lr.end_date)) map.set(date, lr);
    }
    return map;
  }, [leaveRequests]);

  const leaveDates = useMemo(() => new Set(leaveByDate.keys()), [leaveByDate]);

  // work_date -> payroll_summaries row, so finalized days match the figures
  // stored by the nightly job/admin "Recalculate" (same numbers the Payroll
  // page reads) instead of a second, independently live-recomputed total
  // that can drift from it — see buildEmployeeDayRows() in payrollDetail.ts,
  // which the Payroll page uses and applies the same "today's always live"
  // exception.
  const summaryByDate = useMemo(() => {
    const map = new Map<string, PayrollSummary>();
    for (const s of summaries) map.set(s.work_date, s);
    return map;
  }, [summaries]);

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
      // An approved leave day never counts toward Present/Hours/Late/Early/
      // Overtime even if a punch slipped in (e.g. leave approved after a
      // device punch already synced) — the calendar cell already shows
      // "Leave" for it, so the month totals need to agree instead of still
      // counting that punch.
      if (leaveDates.has(date)) continue;
      const status = dayStatus.get(date);
      if (status) {
        present.push({ date, minutes: 0 });
        const summary = date !== todayKey ? summaryByDate.get(date) : undefined;
        const dayTotalMinutes = summary ? Math.round(Number(summary.total_hours) * 60) : status.totalMinutes;
        const dayOvertimeMinutes = summary ? Math.round(Number(summary.overtime_hours) * 60) : status.overtimeMinutes;
        if (status.hasOut || summary) {
          hours.push({ date, minutes: dayTotalMinutes });
          totalWorkMinutes += dayTotalMinutes;
        }
        if (status.isLate) late.push({ date, minutes: status.lateMinutes });
        if (status.isEarly) early.push({ date, minutes: status.earlyMinutes });
        if (dayOvertimeMinutes > 0) {
          overtime.push({ date, minutes: dayOvertimeMinutes });
          overtimeMinutes += dayOvertimeMinutes;
        }
      } else if (date <= todayKey && !leaveDates.has(date)) {
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
  }, [visibleDates, dayStatus, leaveDates, summaryByDate]);

  const selectedLeave = selectedDate ? leaveByDate.get(selectedDate) ?? null : null;

  const selectedDaySummary = useMemo(() => {
    if (dayLogs.length === 0 || !employee) return null;
    return computeDayStatus(dayLogs, resolveShift(employee, shifts));
  }, [dayLogs, employee, shifts]);

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
    <EmployeeShell title="Calendar">
      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employeeId ? (
        <p className="mt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <>
          <MonthCalendar
            dayStatus={dayStatus}
            leaveDates={leaveDates}
            selectedDate={selectedDate}
            onSelectDate={d => setSelectedDate(cur => (cur === d ? null : d))}
            onMonthChange={setVisibleDates}
          />

          {selectedDate && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
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

          <h2 className="mb-3 mt-6 text-sm font-semibold text-ink">This Month</h2>
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(CARD_STYLES) as CardKey[]).map(key => {
              const style = CARD_STYLES[key];
              const open = expandedCard === key;
              return (
                <button
                  key={key}
                  onClick={() => setExpandedCard(open ? null : key)}
                  className={`rounded-xl p-4 text-left ${style.bg} ${open ? 'ring-2 ring-accent' : ''}`}
                >
                  <div className={`text-xs font-medium ${style.text}`}>{style.label}</div>
                  <div className="mt-1 text-xl font-bold text-ink">{cardValue(key)}</div>
                </button>
              );
            })}
          </div>

          {expandedCard && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold text-ink">{CARD_STYLES[expandedCard].label}</h3>
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
                          {!day && <Badge tone="neutral">Absent</Badge>}
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
        </>
      )}
    </EmployeeShell>
  );
}
