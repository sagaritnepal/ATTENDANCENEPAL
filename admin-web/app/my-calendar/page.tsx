'use client';

import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import MonthCalendar from '@/components/MonthCalendar';
import Badge from '@/components/Badge';
import { formatAdDate, formatDdMmYyyy, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { computeDayStatus, formatHoursMinutes, resolveShift } from '@/lib/shift';
import type { AttendanceLog, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';

const WINDOW_DAYS = 400;

/** Decimal hours -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

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

  const todayKey = useMemo(() => localDateKey(new Date().toISOString()), []);

  // work_date -> payroll_summaries row, so finalized days match the figures
  // stored by the nightly job/admin "Recalculate" (same numbers the Payroll
  // page reads) instead of a second, independently live-recomputed total
  // that can drift from it — same "today's always live" exception
  // buildEmployeeDayRows() in payrollDetail.ts uses for the Payroll page.
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
        const isLate = summary ? summary.is_late : status.isLate;
        const lateMinutes = summary ? summary.late_minutes : status.lateMinutes;
        const isEarly = summary ? summary.is_early_departure : status.isEarly;
        const earlyMinutes = summary ? summary.early_departure_minutes : status.earlyMinutes;
        if (isLate) late.push({ date, minutes: lateMinutes });
        if (isEarly) early.push({ date, minutes: earlyMinutes });
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
  }, [visibleDates, dayStatus, leaveDates, summaryByDate, todayKey]);

  // Built from the exact same primitives (dayStatus, summaryByDate,
  // leaveDates, todayKey) as the "This Month" cards above, instead of a
  // separately-recomputed source — so the table can never disagree with
  // what the cards show, whatever day it is.
  const tableRows = useMemo(
    () =>
      visibleDates.map(date => {
        const onLeave = leaveDates.has(date);
        if (onLeave) {
          return {
            date,
            onLeave: true,
            checkIn: null as string | null,
            checkOut: null as string | null,
            hours: 0,
            overtime: 0,
            lateMinutes: 0,
            earlyMinutes: 0,
            present: false,
            absent: false,
          };
        }
        const status = dayStatus.get(date);
        if (!status) {
          return {
            date,
            onLeave: false,
            checkIn: null as string | null,
            checkOut: null as string | null,
            hours: 0,
            overtime: 0,
            lateMinutes: 0,
            earlyMinutes: 0,
            present: false,
            absent: date <= todayKey,
          };
        }
        const summary = date !== todayKey ? summaryByDate.get(date) : undefined;
        return {
          date,
          onLeave: false,
          checkIn: status.checkIn.punch_time,
          checkOut: status.checkOut?.punch_time ?? null,
          hours: summary ? Number(summary.total_hours) : status.totalMinutes / 60,
          overtime: summary ? Number(summary.overtime_hours) : status.overtimeMinutes / 60,
          lateMinutes: summary ? summary.late_minutes : status.lateMinutes,
          earlyMinutes: summary ? summary.early_departure_minutes : status.earlyMinutes,
          present: true,
          absent: false,
        };
      }),
    [visibleDates, leaveDates, dayStatus, summaryByDate, todayKey]
  );

  const chartData = useMemo(
    () => tableRows.map(row => ({ label: formatDdMmYyyy(row.date, system).slice(0, 2), hours: row.present ? row.hours : 0 })),
    [tableRows, system]
  );

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

          {tableRows.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full table-fixed text-center text-[10px]">
                <colgroup>
                  <col className="w-[15%]" />
                  <col className="w-[13%]" />
                  <col className="w-[13%]" />
                  <col className="w-[17%]" />
                  <col className="w-[12%]" />
                  <col className="w-[14%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500">
                    <th className="truncate px-0.5 py-1 font-medium">Date</th>
                    <th className="truncate px-0.5 py-1 font-medium">In</th>
                    <th className="truncate px-0.5 py-1 font-medium">Out</th>
                    <th className="truncate px-0.5 py-1 font-medium">Late/Early</th>
                    <th className="truncate px-0.5 py-1 font-medium">Status</th>
                    <th className="truncate px-0.5 py-1 font-medium">Hrs</th>
                    <th className="truncate px-0.5 py-1 font-medium">OT</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, i) => {
                    const fmtTime = (t: string | null) =>
                      t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
                    return (
                      <tr key={row.date} className={`border-b border-slate-100 last:border-0 ${i % 2 === 1 ? 'bg-slate-50/60' : ''}`}>
                        <td className="truncate px-0.5 py-0.5 text-ink">{formatDdMmYyyy(row.date, system).slice(0, 5)}</td>
                        <td className="truncate px-0.5 py-0.5 text-slate-600">{row.onLeave ? '—' : fmtTime(row.checkIn)}</td>
                        <td className="truncate px-0.5 py-0.5 text-slate-600">{row.onLeave ? '—' : fmtTime(row.checkOut)}</td>
                        <td className="truncate px-0.5 py-0.5 font-medium">
                          {row.onLeave || !row.present ? (
                            <span className="text-slate-300">—</span>
                          ) : row.lateMinutes === 0 && row.earlyMinutes === 0 ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            <>
                              {row.lateMinutes > 0 && <span className="text-warning-text">{formatHoursMinutes(row.lateMinutes)}</span>}
                              {row.lateMinutes > 0 && row.earlyMinutes > 0 && ' '}
                              {row.earlyMinutes > 0 && <span className="text-critical-text">{formatHoursMinutes(row.earlyMinutes)}</span>}
                            </>
                          )}
                        </td>
                        <td className="truncate px-0.5 py-0.5 font-medium">
                          {row.onLeave ? (
                            <span className="text-slate-300">—</span>
                          ) : row.present ? (
                            <span className="text-good-text">Present</span>
                          ) : row.absent ? (
                            <span className="text-critical-text">Absent</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="truncate px-0.5 py-0.5 text-slate-600">{row.present ? fmtHrs(row.hours) : '—'}</td>
                        <td className="truncate px-0.5 py-0.5 text-info-text">{row.present ? fmtHrs(row.overtime) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    let sumHours = 0;
                    let sumOvertime = 0;
                    let presentCount = 0;
                    let absentCount = 0;
                    for (const row of tableRows) {
                      if (row.present) {
                        sumHours += row.hours;
                        sumOvertime += row.overtime;
                        presentCount += 1;
                      } else if (row.absent) {
                        absentCount += 1;
                      }
                    }
                    return (
                      <>
                        <tr className="border-t-2 border-slate-200 bg-slate-50 text-ink">
                          <td className="truncate px-0.5 py-1 font-semibold" colSpan={4}>
                            Total
                          </td>
                          <td className="px-0.5 py-1" />
                          <td className="truncate px-0.5 py-1 font-semibold">{fmtHrs(sumHours)}</td>
                          <td className="truncate px-0.5 py-1 font-semibold text-info-text">{fmtHrs(sumOvertime)}</td>
                        </tr>
                        <tr className="border-t border-slate-200 bg-slate-50 text-ink">
                          <td className="truncate px-0.5 py-1 font-semibold" colSpan={4}>
                            Present / Absent
                          </td>
                          <td className="truncate px-0.5 py-1 font-semibold text-good-text" colSpan={3}>
                            {presentCount} / <span className="text-critical-text">{absentCount}</span>
                          </td>
                        </tr>
                      </>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
          )}

          <div className="mb-2 mt-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-ink">Hours Trend</h2>
            <span className="text-[10px] text-slate-400">Scroll to see all days →</span>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            {chartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No data to chart yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <div style={{ width: Math.max(chartData.length * 30, 320), height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} interval={0} />
                      <YAxis tick={{ fontSize: 9, fill: '#0d9488' }} axisLine={false} tickLine={false} allowDecimals={false} width={22} />
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                        formatter={(v: number) => [`${v.toFixed(1)} hrs`, 'Hours']}
                      />
                      <Line
                        type="monotone"
                        dataKey="hours"
                        name="hours"
                        stroke="#0d9488"
                        strokeWidth={2}
                        dot={{ r: 2, fill: '#0d9488' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
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
