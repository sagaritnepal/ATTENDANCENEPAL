import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, Employee, LeaveRequest, Shift } from '../types';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  resolveShiftForDate,
  type DailyShiftByDate,
  type DayStatus,
} from '../lib/shift';
import { colors } from '../theme';
import Badge from '../components/Badge';
import MonthCalendarGrid from '../components/MonthCalendarGrid';
import { formatAdDate, formatDdMmYyyy } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';

const WINDOW_DAYS = 400;

function localDateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function datesBetween(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const last = new Date(ey, em - 1, ed);
  const dates: string[] = [];
  for (let d = new Date(sy, sm - 1, sd); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    dates.push(localDateKey(d.toISOString()));
  }
  return dates;
}

type CardKey = 'hours' | 'late' | 'early' | 'overtime' | 'present' | 'absent';
type CardEntry = { date: string; minutes: number };

const CARD_STYLES: Record<CardKey, { label: string; bg: string; text: string }> = {
  hours: { label: 'Total Work Hours', bg: colors.goodBg, text: colors.goodText },
  late: { label: 'Late In', bg: colors.warningBg, text: colors.warningText },
  early: { label: 'Early Out', bg: colors.criticalBg, text: colors.criticalText },
  overtime: { label: 'Overtime', bg: colors.infoBg, text: colors.infoText },
  present: { label: 'Present Days', bg: colors.goodBg, text: colors.goodText },
  absent: { label: 'Absent Days', bg: colors.slate100, text: colors.slate500 },
};

export default function MyCalendarScreen() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<AttendanceLog[]>([]);
  const [visibleDates, setVisibleDates] = useState<string[]>([]);
  const [expandedCard, setExpandedCard] = useState<CardKey | null>(null);
  const [tab, setTab] = useState<'day' | 'leave' | 'report'>('day');

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setLoading(false);
      if (!profile?.employee_id) return;
      setEmployeeId(profile.employee_id);
      const { data: emp } = await supabase.from('employees').select('*').eq('id', profile.employee_id).single();
      setEmployee((emp as Employee) ?? null);
    });
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('punch_time', since)
      .order('punch_time', { ascending: true })
      .then(({ data }) => setLogs((data as AttendanceLog[]) ?? []));
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .then(({ data }) => setLeaveRequests((data as LeaveRequest[]) ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('work_date, shift_id')
      .eq('employee_id', employeeId)
      .gte('work_date', since.slice(0, 10))
      .then(({ data }) => setDailyShiftRows((data as any) ?? []));
  }, [employeeId]);

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
    const map = new Map<string, DayStatus>();
    if (!employee) return map;
    applyOvernightShiftCorrection(byDate, logs, employee, shifts, dailyShiftByDate);
    for (const [date, dLogs] of byDate) {
      const resolved = resolveShiftForDate(employee, shifts, date, dailyShiftByDate);
      map.set(date, computeDayStatusForResolvedShift(dLogs, resolved));
    }
    return map;
  }, [logs, employee, shifts, dailyShiftByDate]);

  const leaveByDate = useMemo(() => {
    const map = new Map<string, LeaveRequest>();
    for (const lr of leaveRequests) for (const date of datesBetween(lr.start_date, lr.end_date)) map.set(date, lr);
    return map;
  }, [leaveRequests]);
  const leaveDates = useMemo(() => new Set(leaveByDate.keys()), [leaveByDate]);

  const weekOffDates = useMemo(() => {
    const set = new Set<string>();
    const perDate = dailyShiftByDate.get(employeeId ?? '');
    if (!perDate) return set;
    for (const [date, shiftId] of perDate) if (shiftId === null) set.add(date);
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
      entries: { hours: hours.sort(byDateDesc), late: late.sort(byDateDesc), early: early.sort(byDateDesc), overtime: overtime.sort(byDateDesc), present: present.sort(byDateDesc), absent: absent.sort(byDateDesc) } as Record<CardKey, CardEntry[]>,
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
    const start = `${selectedDate}T00:00:00`;
    const end = new Date(new Date(start).getTime() + 86400000).toISOString();
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('punch_time', start)
      .lt('punch_time', end)
      .order('punch_time', { ascending: true })
      .then(({ data }) => setDayLogs((data as AttendanceLog[]) ?? []));
  }, [selectedDate, employeeId]);

  const reportRows = useMemo(() => {
    const todayKey = localDateKey(new Date().toISOString());
    return [...visibleDates]
      .sort((a, b) => b.localeCompare(a))
      .map(date => {
        const status = dayStatus.get(date);
        const onLeave = leaveDates.has(date);
        const onWeekOff = weekOffDates.has(date);
        return { date, status, onLeave, onWeekOff, isFuture: date > todayKey };
      });
  }, [visibleDates, dayStatus, leaveDates, weekOffDates]);

  function cardValue(key: CardKey) {
    if (key === 'hours') return formatHoursMinutes(monthSummary.totalWorkMinutes);
    if (key === 'overtime') return formatHoursMinutes(monthSummary.overtimeMinutes);
    const count = monthSummary.entries[key].length;
    return `${count} day${count === 1 ? '' : 's'}`;
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!employeeId) {
    return (
      <View style={styles.center}>
        <Text style={styles.warn}>Your account isn't linked to an employee record yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.statsGrid}>
        {(Object.keys(CARD_STYLES) as CardKey[]).map(key => {
          const style = CARD_STYLES[key];
          const open = expandedCard === key;
          return (
            <TouchableOpacity key={key} style={[styles.statCard, { backgroundColor: style.bg }, open && styles.statCardOpen]} onPress={() => setExpandedCard(open ? null : key)}>
              <Text style={[styles.statValue, { color: style.text }]}>{cardValue(key)}</Text>
              <Text style={styles.statLabel}>{style.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {expandedCard && (
        <View style={styles.expandedCard}>
          <Text style={styles.expandedTitle}>{CARD_STYLES[expandedCard].label} this month</Text>
          {monthSummary.entries[expandedCard].length === 0 ? (
            <Text style={styles.dim}>Nothing to show for this month.</Text>
          ) : (
            monthSummary.entries[expandedCard].map(entry => {
              const day = dayStatus.get(entry.date);
              return (
                <View key={entry.date} style={styles.expandedRow}>
                  <Text style={styles.expandedDate}>{formatAdDate(entry.date, system)}</Text>
                  {!day && <Badge tone="critical">Absent</Badge>}
                  {day?.isLate && <Badge tone="warning">Late</Badge>}
                </View>
              );
            })
          )}
        </View>
      )}

      <MonthCalendarGrid
        dayStatus={dayStatus}
        leaveDates={leaveDates}
        weekOffDates={weekOffDates}
        selectedDate={selectedDate}
        onSelectDate={d => {
          setSelectedDate(d);
          setTab('day');
        }}
        onMonthChange={setVisibleDates}
      />

      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'day' && styles.tabBtnActive]} onPress={() => setTab('day')}>
          <Text style={[styles.tabText, tab === 'day' && styles.tabTextActive]}>Day Detail</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'leave' && styles.tabBtnActive]} onPress={() => setTab('leave')}>
          <Text style={[styles.tabText, tab === 'leave' && styles.tabTextActive]}>Recent Leave</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'report' && styles.tabBtnActive]} onPress={() => setTab('report')}>
          <Text style={[styles.tabText, tab === 'report' && styles.tabTextActive]}>Report</Text>
        </TouchableOpacity>
      </View>

      {tab === 'day' && (
        <View style={styles.detailCard}>
          {!selectedDate ? (
            <Text style={styles.dim}>Pick a day on the calendar to see its detail.</Text>
          ) : (
            <>
              <Text style={styles.detailTitle}>{formatAdDate(selectedDate, system)}</Text>
              {selectedLeave && (
                <View style={styles.leaveBanner}>
                  <Text style={styles.leaveBannerLabel}>On Leave</Text>
                  <Text style={styles.leaveBannerType}>{selectedLeave.leave_type}</Text>
                </View>
              )}
              {!selectedDaySummary && !selectedLeave && <Text style={styles.dim}>No punches recorded.</Text>}
              {selectedDaySummary && (
                <View style={{ gap: 10 }}>
                  <View style={styles.grid2}>
                    <View style={[styles.detailCell, { backgroundColor: colors.goodBg }]}>
                      <Text style={[styles.detailCellLabel, { color: colors.goodText }]}>IN</Text>
                      <Text style={styles.detailCellValue}>{new Date(selectedDaySummary.checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                      {selectedDaySummary.isLate && <Badge tone="warning">Late {formatHoursMinutes(selectedDaySummary.lateMinutes)}</Badge>}
                    </View>
                    <View style={[styles.detailCell, { backgroundColor: colors.warningBg }]}>
                      <Text style={[styles.detailCellLabel, { color: colors.warningText }]}>OUT</Text>
                      <Text style={styles.detailCellValue}>{selectedDaySummary.checkOut ? new Date(selectedDaySummary.checkOut.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not yet'}</Text>
                      {selectedDaySummary.isEarly && <Badge tone="critical">Early {formatHoursMinutes(selectedDaySummary.earlyMinutes)}</Badge>}
                    </View>
                  </View>
                  <View style={styles.grid2}>
                    <View style={[styles.detailCell, { backgroundColor: colors.goodBg }]}>
                      <Text style={[styles.detailCellLabel, { color: colors.goodText }]}>Total Work Hours</Text>
                      <Text style={styles.detailCellValue}>{formatHoursMinutes(selectedDaySummary.totalMinutes)}</Text>
                    </View>
                    <View style={[styles.detailCell, { backgroundColor: colors.infoBg }]}>
                      <Text style={[styles.detailCellLabel, { color: colors.infoText }]}>Overtime</Text>
                      <Text style={styles.detailCellValue}>{formatHoursMinutes(selectedDaySummary.overtimeMinutes)}</Text>
                    </View>
                  </View>
                </View>
              )}
            </>
          )}
        </View>
      )}

      {tab === 'leave' && (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>Recent Leave</Text>
          {leaveRequests.length === 0 ? (
            <Text style={styles.dim}>No approved leave on record.</Text>
          ) : (
            [...leaveRequests]
              .sort((a, b) => b.start_date.localeCompare(a.start_date))
              .map(lr => (
                <View key={lr.id} style={styles.leaveRow}>
                  <Text style={styles.leaveRowDate}>
                    {formatAdDate(lr.start_date, system)}
                    {lr.start_date !== lr.end_date ? ` – ${formatAdDate(lr.end_date, system)}` : ''}
                  </Text>
                  <Badge tone="info">{lr.leave_type}</Badge>
                </View>
              ))
          )}
        </View>
      )}

      {tab === 'report' && (
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>Attendance Report — this month</Text>
          <View style={styles.reportHeader}>
            <Text style={[styles.reportTh, { flex: 0.22 }]}>Date</Text>
            <Text style={[styles.reportTh, { flex: 0.28 }]}>In / Out</Text>
            <Text style={[styles.reportTh, { flex: 0.22 }]}>Status</Text>
            <Text style={[styles.reportTh, { flex: 0.14 }]}>Hrs</Text>
            <Text style={[styles.reportTh, { flex: 0.14 }]}>OT</Text>
          </View>
          {reportRows.length === 0 ? (
            <Text style={styles.dim}>No records for this month.</Text>
          ) : (
            reportRows.map((row, i) => (
              <View key={row.date} style={[styles.reportRow, i % 2 === 1 && styles.reportRowAlt]}>
                <Text style={[styles.reportTd, { flex: 0.22 }]}>{formatDdMmYyyy(row.date, system).slice(0, 5)}</Text>
                <Text style={[styles.reportTd, { flex: 0.28 }]}>
                  {row.status?.checkIn ? new Date(row.status.checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–:–'}-
                  {row.status?.checkOut ? new Date(row.status.checkOut.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–:–'}
                </Text>
                <Text
                  style={[
                    styles.reportTd,
                    { flex: 0.22 },
                    row.onLeave || row.onWeekOff
                      ? { color: '#7e22ce' }
                      : row.status
                        ? row.status.isLate
                          ? { color: colors.warningText }
                          : { color: colors.goodText }
                        : row.isFuture
                          ? styles.dim
                          : { color: colors.criticalText },
                  ]}
                >
                  {row.onLeave ? 'On Leave' : row.onWeekOff ? 'Week Off' : row.status ? (row.status.isLate ? 'Late' : 'Present') : row.isFuture ? '—' : 'Absent'}
                </Text>
                <Text style={[styles.reportTd, { flex: 0.14 }]}>{row.status ? formatHoursMinutes(row.status.totalMinutes) : '—'}</Text>
                <Text style={[styles.reportTd, { flex: 0.14, color: colors.infoText }]}>{row.status && row.status.overtimeMinutes > 0 ? formatHoursMinutes(row.status.overtimeMinutes) : '—'}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: {
    flexBasis: '31%',
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  statCardOpen: { borderColor: colors.accent },
  statValue: { fontSize: 14, fontWeight: '700' },
  statLabel: { fontSize: 9, color: colors.ink, marginTop: 3, fontWeight: '600' },
  expandedCard: { backgroundColor: colors.white, borderRadius: 16, padding: 14, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  expandedTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  expandedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.slate100 },
  expandedDate: { fontSize: 18, color: colors.ink, fontWeight: '600' },
  dim: { fontSize: 12, color: colors.slate400 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 4,
    marginTop: 14,
    alignSelf: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  tabBtnActive: { backgroundColor: colors.accent },
  tabText: { fontSize: 12, fontWeight: '700', color: colors.slate500 },
  tabTextActive: { color: colors.white },
  detailCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  detailTitle: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  leaveBanner: { backgroundColor: '#f3e8ff', borderRadius: 12, padding: 10, marginBottom: 10 },
  leaveBannerLabel: { fontSize: 11, fontWeight: '600', color: '#7e22ce' },
  leaveBannerType: { fontSize: 15, fontWeight: '700', color: colors.ink, textTransform: 'capitalize' },
  grid2: { flexDirection: 'row', gap: 10 },
  detailCell: { flex: 1, borderRadius: 12, padding: 10 },
  detailCellLabel: { fontSize: 11, fontWeight: '600' },
  detailCellValue: { fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 2, marginBottom: 4 },
  leaveRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.slate100 },
  leaveRowDate: { fontSize: 18, color: colors.ink },
  reportHeader: { flexDirection: 'row', backgroundColor: colors.slate50, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6 },
  reportTh: { fontSize: 9, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase', paddingHorizontal: 2 },
  reportRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  reportRowAlt: { backgroundColor: colors.slate50 },
  reportTd: { fontSize: 11, color: colors.slate500, paddingHorizontal: 2 },
});
