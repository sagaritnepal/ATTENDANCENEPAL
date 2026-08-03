'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import MonthCalendar from '@/components/MonthCalendar';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { computeDayStatus, formatHoursMinutes, formatMinutes, resolveShift } from '@/lib/shift';
import type { AttendanceLog, Employee, Shift } from '@/lib/types';

const WINDOW_DAYS = 400;

type CardKey = 'hours' | 'late' | 'early' | 'overtime';
type CardEntry = { date: string; minutes: number };

const CARD_STYLES: Record<CardKey, { label: string; bg: string; text: string }> = {
  hours: { label: 'Total Work Hours', bg: 'bg-good-bg', text: 'text-good-text' },
  late: { label: 'Late In', bg: 'bg-warning-bg', text: 'text-warning-text' },
  early: { label: 'Early Out', bg: 'bg-critical-bg', text: 'text-critical-text' },
  overtime: { label: 'Overtime', bg: 'bg-info-bg', text: 'text-info-text' },
};

export default function MyCalendarPage() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
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
      const [{ data: emp }, { data: shiftRows }, { data: rows }] = await Promise.all([
        supabase.from('employees').select('*').eq('id', profile.employee_id).single(),
        supabase.from('shifts').select('*'),
        supabase
          .from('attendance_logs')
          .select('*')
          .eq('employee_id', profile.employee_id)
          .gte('punch_time', new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString())
          .order('punch_time', { ascending: true }),
      ]);
      setEmployee(emp ?? null);
      setShifts(shiftRows ?? []);
      setLogs(rows ?? []);
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

  const monthSummary = useMemo(() => {
    const hours: CardEntry[] = [];
    const late: CardEntry[] = [];
    const early: CardEntry[] = [];
    const overtime: CardEntry[] = [];
    let totalWorkMinutes = 0;
    let overtimeMinutes = 0;

    for (const date of visibleDates) {
      const status = dayStatus.get(date);
      if (!status) continue;
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
      } satisfies Record<CardKey, CardEntry[]>,
    };
  }, [visibleDates, dayStatus]);

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
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onMonthChange={setVisibleDates}
          />

          {selectedDate && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">{formatAdDate(selectedDate, system)}</h2>
              {dayLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : !selectedDaySummary ? (
                <p className="text-sm text-slate-400">No punches recorded.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="w-12 shrink-0 rounded-md bg-good-bg px-2 py-1 text-center text-xs font-bold text-good-text">
                      IN
                    </span>
                    <span className="text-sm text-ink">
                      {new Date(selectedDaySummary.checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-xs capitalize text-slate-400">{selectedDaySummary.checkIn.method}</span>
                  </div>
                  {selectedDaySummary.checkOut && (
                    <div className="flex items-center gap-3">
                      <span className="w-12 shrink-0 rounded-md bg-warning-bg px-2 py-1 text-center text-xs font-bold text-warning-text">
                        OUT
                      </span>
                      <span className="text-sm text-ink">
                        {new Date(selectedDaySummary.checkOut.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs capitalize text-slate-400">{selectedDaySummary.checkOut.method}</span>
                    </div>
                  )}
                  {selectedDaySummary.isLate && (
                    <p className="text-xs font-medium text-warning-text">Late by {formatMinutes(selectedDaySummary.lateMinutes)}</p>
                  )}
                  {selectedDaySummary.isEarly && (
                    <p className="text-xs font-medium text-critical-text">
                      Early out by {formatMinutes(selectedDaySummary.earlyMinutes)}
                    </p>
                  )}
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
                  {monthSummary.entries[expandedCard].map(entry => (
                    <div key={entry.date} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-ink">{formatAdDate(entry.date, system)}</span>
                      <span className="font-medium text-slate-600">
                        {expandedCard === 'hours' ? formatHoursMinutes(entry.minutes) : formatMinutes(entry.minutes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </EmployeeShell>
  );
}
