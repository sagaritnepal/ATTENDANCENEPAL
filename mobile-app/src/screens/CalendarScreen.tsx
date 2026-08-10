import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal, FlatList, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, Device, Employee, LeaveRequest, PayrollSummary, Shift } from '../types';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  isWeekOff,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
  type DayStatus,
} from '../lib/shift';
import { colors } from '../theme';
import Badge from '../components/Badge';
import MonthCalendarGrid from '../components/MonthCalendarGrid';
import DateRangePicker from '../components/DateRangePicker';
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
function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}
function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '–:–';
}

type CardKey = 'hours' | 'late' | 'early' | 'overtime' | 'present' | 'absent';
type CardEntry = { date: string; minutes: number };

const CARD_STYLES: Record<CardKey, { label: string; bg: string; text: string }> = {
  hours: { label: 'Total Work Hours', bg: colors.goodBg, text: colors.goodText },
  late: { label: 'Late In', bg: colors.warningBg, text: colors.warningText },
  early: { label: 'Early Out', bg: colors.criticalBg, text: colors.criticalText },
  overtime: { label: 'Overtime', bg: colors.infoBg, text: colors.infoText },
  present: { label: 'Present Days', bg: colors.accentLight, text: colors.accent },
  absent: { label: 'Absent Days', bg: colors.criticalBg, text: colors.criticalText },
};

// Full desktop-style column set (moved here from the old standalone
// Attendance screen) — horizontal-scrolling, every column visible, as it
// was before that screen got compacted to match web's phone view.
const TABLE_COLS = [
  { key: 'date', label: 'Date', width: 64 },
  { key: 'enrollId', label: 'ID', width: 48 },
  { key: 'employeeName', label: 'Employee', width: 120 },
  { key: 'shiftLabel', label: 'Shift', width: 130 },
  { key: 'inOut', label: 'In / Out', width: 100 },
  { key: 'lateEarly', label: 'Late/Early', width: 90 },
  { key: 'hours', label: 'Work Hrs', width: 64 },
  { key: 'overtime', label: 'OT', width: 56 },
  { key: 'status', label: 'Status', width: 64 },
  { key: 'device', label: 'Device', width: 110 },
] as const;
const TABLE_WIDTH = TABLE_COLS.reduce((s, c) => s + c.width, 0);
const TABLE_STATUS_OPTIONS = ['All', 'Present', 'Absent', 'Late', 'Early'] as const;

type TableRow = {
  key: string;
  date: string;
  enrollId: string;
  employeeName: string;
  device: string;
  shiftLabel: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming';
  lateMinutes: number;
  earlyMinutes: number;
  overtime: number;
};

export default function CalendarScreen() {
  const { system } = useCalendarSystem();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<AttendanceLog[]>([]);
  const [visibleDates, setVisibleDates] = useState<string[]>([]);
  const [expandedCard, setExpandedCard] = useState<CardKey | null>(null);
  const [tab, setTab] = useState<'day' | 'leave'>('day');

  // Independent state for the attendance table moved in from the old
  // standalone Attendance screen — its own date range/employee/status
  // filters, decoupled from the single-employee context above (that one
  // drives Day Detail/Recent Leave; this one can show every employee).
  const [tableFrom, setTableFrom] = useState(isoDaysAgo(6));
  const [tableTo, setTableTo] = useState(isoDaysAgo(0));
  const [tableStatus, setTableStatus] = useState<(typeof TABLE_STATUS_OPTIONS)[number]>('All');
  const [tableStatusOpen, setTableStatusOpen] = useState(false);
  const [tableEmployeeId, setTableEmployeeId] = useState('all');
  const [tableEmployeeOpen, setTableEmployeeOpen] = useState(false);
  const [tableDevices, setTableDevices] = useState<Device[]>([]);
  const [tableSummaries, setTableSummaries] = useState<PayrollSummary[]>([]);
  const [tableLogs, setTableLogs] = useState<AttendanceLog[]>([]);
  const [tableDailyShiftRows, setTableDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [tableLoading, setTableLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => {
        setEmployees((data as Employee[]) ?? []);
        if (data && data.length > 0) setEmployeeId(data[0].id);
      });
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
    supabase.from('devices').select('*').then(({ data }) => setTableDevices((data as Device[]) ?? []));
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

  useEffect(() => {
    setTableLoading(true);
    Promise.all([
      supabase.from('payroll_summaries').select('*').gte('work_date', tableFrom).lte('work_date', tableTo),
      supabase.from('attendance_logs').select('*').gte('punch_time', `${tableFrom}T00:00:00Z`).lte('punch_time', `${tableTo}T23:59:59Z`),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', tableFrom).lte('work_date', tableTo),
    ]).then(([summariesRes, logsRes, rosterRes]) => {
      setTableSummaries((summariesRes.data as PayrollSummary[]) ?? []);
      setTableLogs((logsRes.data as AttendanceLog[]) ?? []);
      setTableDailyShiftRows((rosterRes.data as any) ?? []);
      setTableLoading(false);
    });
  }, [tableFrom, tableTo]);

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
    const perDate = dailyShiftByDate.get(employeeId);
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

  function cardValue(key: CardKey) {
    if (key === 'hours') return formatHoursMinutes(monthSummary.totalWorkMinutes);
    if (key === 'overtime') return formatHoursMinutes(monthSummary.overtimeMinutes);
    const count = monthSummary.entries[key].length;
    return `${count} day${count === 1 ? '' : 's'}`;
  }

  // --- Attendance table (moved in from the old standalone Attendance screen) ---

  const tableDailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of tableDailyShiftRows) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(r.work_date, r.shift_id);
    }
    return map;
  }, [tableDailyShiftRows]);

  const tableDeviceName = (id: string | null | undefined) => tableDevices.find(d => d.id === id)?.name ?? 'Mobile / QR / Selfie';

  const tableScopedEmployees = useMemo(
    () => (tableEmployeeId === 'all' ? employees : employees.filter(e => e.id === tableEmployeeId)),
    [employees, tableEmployeeId]
  );

  const tableRows: TableRow[] = useMemo(() => {
    const days: string[] = [];
    const cur = new Date(tableFrom + 'T00:00:00Z');
    const end = new Date(tableTo + 'T00:00:00Z');
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const today = nepalTodayIso();

    const logsByEmployeeDay = new Map<string, Map<string, AttendanceLog[]>>();
    for (const emp of tableScopedEmployees) {
      const empLogs = tableLogs.filter(l => l.employee_id === emp.id);
      const byDate = new Map<string, AttendanceLog[]>();
      for (const day of days) {
        const dayLogs = empLogs.filter(l => l.punch_time.slice(0, 10) === day);
        if (dayLogs.length > 0) byDate.set(day, dayLogs);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, tableDailyShiftByDate);
      logsByEmployeeDay.set(emp.id, byDate);
    }

    const out: TableRow[] = [];
    for (const day of days) {
      for (const emp of tableScopedEmployees) {
        const summary = day === today ? undefined : tableSummaries.find(s => s.employee_id === emp.id && s.work_date === day);
        const dayLogs = (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        const resolved = resolveShiftForDate(emp, shifts, day, tableDailyShiftByDate);
        const shiftLabel = isWeekOff(resolved) ? 'Week Off' : `${resolved.name} (${resolved.start_time.slice(0, 5)}–${resolved.end_time.slice(0, 5)})`;

        if (summary) {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: tableDeviceName(dayLogs[0]?.device_id ?? null),
            shiftLabel,
            checkIn: summary.check_in,
            checkOut: summary.check_out,
            hours: summary.total_hours,
            status: summary.is_late ? 'Late' : 'Present',
            lateMinutes: summary.is_late ? summary.late_minutes : 0,
            earlyMinutes: summary.is_early_departure ? summary.early_departure_minutes : 0,
            overtime: summary.overtime_hours,
          });
        } else if (dayLogs.length > 0) {
          const live = computeDayStatusForResolvedShift(dayLogs, resolved);
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: tableDeviceName(dayLogs[0].device_id ?? null),
            shiftLabel,
            checkIn: live.checkIn.punch_time,
            checkOut: live.checkOut?.punch_time ?? null,
            hours: live.totalMinutes / 60,
            status: live.isLate ? 'Late' : 'Present',
            lateMinutes: live.lateMinutes,
            earlyMinutes: live.earlyMinutes,
            overtime: live.overtimeMinutes / 60,
          });
        } else {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: 'N/A',
            shiftLabel,
            checkIn: null,
            checkOut: null,
            hours: 0,
            status: day > today ? 'Upcoming' : 'Absent',
            lateMinutes: 0,
            earlyMinutes: 0,
            overtime: 0,
          });
        }
      }
    }
    return out
      .filter(r => tableStatus === 'All' || (tableStatus === 'Early' ? r.earlyMinutes > 0 : r.status === tableStatus))
      .sort((a, b) => b.date.localeCompare(a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableScopedEmployees, tableSummaries, tableLogs, shifts, tableFrom, tableTo, tableStatus, tableDailyShiftByDate, tableDevices]);

  const tableTotals = useMemo(() => {
    const workHours = tableRows.reduce((sum, r) => sum + r.hours, 0);
    const overtimeHours = tableRows.reduce((sum, r) => sum + r.overtime, 0);
    const lateMinutes = tableRows.reduce((sum, r) => sum + r.lateMinutes, 0);
    const earlyMinutes = tableRows.reduce((sum, r) => sum + r.earlyMinutes, 0);
    const presentDays = tableRows.filter(r => r.checkIn).length;
    const absentDays = tableRows.filter(r => !r.checkIn && r.status !== 'Upcoming').length;
    return { workHours, overtimeHours, lateMinutes, earlyMinutes, presentDays, absentDays };
  }, [tableRows]);

  async function exportTableCsv() {
    const header = ['Date', 'ID', 'Employee', 'Shift', 'Check-In', 'Check-Out', 'Late By (min)', 'Early Out (min)', 'Total Work Hours', 'Overtime', 'Status', 'Device'];
    const lines = tableRows.map(r =>
      [
        r.date,
        r.enrollId,
        r.employeeName,
        r.shiftLabel,
        r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour12: false }) : '',
        r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour12: false }) : '',
        r.lateMinutes || '',
        r.earlyMinutes || '',
        r.hours.toFixed(1),
        r.overtime.toFixed(1),
        r.status,
        r.device,
      ]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const fileUri = `${FileSystem.cacheDirectory}attendance_${tableFrom}_to_${tableTo}.csv`;
    await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Export attendance CSV' });
    } else {
      Alert.alert('Sharing is not available on this device.');
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <TouchableOpacity style={styles.employeePicker} onPress={() => setEmployeePickerOpen(true)}>
          <Text style={styles.employeePickerLabel}>Employee</Text>
          <Text style={styles.employeePickerValue}>{employee?.name ?? 'Select…'}</Text>
        </TouchableOpacity>

        <View style={styles.statsGrid}>
          {(Object.keys(CARD_STYLES) as CardKey[]).map(key => {
            const style = CARD_STYLES[key];
            const open = expandedCard === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.statCard, { backgroundColor: style.bg }, open && styles.statCardOpen]}
                onPress={() => setExpandedCard(open ? null : key)}
              >
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

        <View style={styles.tableSection}>
          <Text style={styles.tableSectionTitle}>Attendance Report</Text>
          <View style={styles.tableFilterBar}>
            <DateRangePicker from={tableFrom} to={tableTo} onChange={(f, t) => { setTableFrom(f); setTableTo(t); }} />
            <View style={styles.filterChipsRow}>
              <TouchableOpacity style={styles.chip} onPress={() => setTableEmployeeOpen(true)}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {tableEmployeeId === 'all' ? 'All Employees' : employees.find(e => e.id === tableEmployeeId)?.name ?? 'Employee'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.chip} onPress={() => setTableStatusOpen(true)}>
                <Text style={styles.chipText}>{tableStatus === 'All' ? 'All Logs' : tableStatus}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.exportBtn} onPress={exportTableCsv}>
              <Text style={styles.exportBtnText}>⭳ Export CSV</Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ width: TABLE_WIDTH }}>
            <View>
              <View style={styles.rawTableHeader}>
                {TABLE_COLS.map(c => (
                  <Text key={c.key} style={[styles.th, { width: c.width }]}>
                    {c.label}
                  </Text>
                ))}
              </View>
              {tableRows.map((item, index) => (
                <View key={item.key} style={[styles.tr, index % 2 === 1 && styles.trAlt]}>
                  <Text style={[styles.td, { width: 64 }]}>{formatDdMmYyyy(item.date, system).slice(0, 5)}</Text>
                  <Text style={[styles.td, { width: 48 }]}>{item.enrollId}</Text>
                  <Text style={[styles.td, styles.tdName, { width: 120 }]} numberOfLines={1}>
                    {item.employeeName}
                  </Text>
                  <Text style={[styles.td, { width: 130 }]} numberOfLines={1}>
                    {item.shiftLabel}
                  </Text>
                  <Text style={[styles.td, { width: 100 }]}>
                    {fmtTime(item.checkIn)}-{fmtTime(item.checkOut)}
                  </Text>
                  <Text style={[styles.td, { width: 90 }]}>
                    {item.lateMinutes === 0 && item.earlyMinutes === 0 && <Text style={styles.dim}>—</Text>}
                    {item.lateMinutes > 0 && <Text style={{ color: colors.warningText }}>L{formatHoursMinutes(item.lateMinutes)}</Text>}
                    {item.earlyMinutes > 0 && <Text style={{ color: colors.criticalText }}> E{formatHoursMinutes(item.earlyMinutes)}</Text>}
                  </Text>
                  <Text style={[styles.td, { width: 64 }]}>{fmtHrs(item.hours)}</Text>
                  <Text style={[styles.td, { width: 56, color: colors.infoText }]}>{fmtHrs(item.overtime)}</Text>
                  <Text
                    style={[
                      styles.td,
                      { width: 64 },
                      item.checkIn ? { color: colors.goodText } : item.status === 'Upcoming' ? styles.dim : { color: colors.criticalText },
                    ]}
                  >
                    {item.checkIn ? 'Present' : item.status === 'Upcoming' ? 'Upcoming' : 'Absent'}
                  </Text>
                  <Text style={[styles.td, { width: 110 }]} numberOfLines={1}>
                    {item.device}
                  </Text>
                </View>
              ))}
              {tableRows.length === 0 && <Text style={styles.empty}>{tableLoading ? 'Loading…' : 'No records in this range.'}</Text>}
              {tableRows.length > 0 && (
                <View style={styles.footerRow}>
                  <Text style={[styles.tf, { width: 64 + 48 + 120 }]}>Total</Text>
                  <Text style={[styles.tf, { width: 130 }]} />
                  <Text style={[styles.tf, { width: 100 }]}>
                    <Text style={{ color: colors.goodText }}>{tableTotals.presentDays}P</Text> <Text style={{ color: colors.criticalText }}>{tableTotals.absentDays}A</Text>
                  </Text>
                  <Text style={[styles.tf, { width: 90 }]}>
                    {tableTotals.lateMinutes > 0 && <Text style={{ color: colors.warningText }}>L{formatHoursMinutes(tableTotals.lateMinutes)}</Text>}
                    {tableTotals.earlyMinutes > 0 && <Text style={{ color: colors.criticalText }}> E{formatHoursMinutes(tableTotals.earlyMinutes)}</Text>}
                    {tableTotals.lateMinutes === 0 && tableTotals.earlyMinutes === 0 && '—'}
                  </Text>
                  <Text style={[styles.tf, { width: 64 }]}>{fmtHrs(tableTotals.workHours)}</Text>
                  <Text style={[styles.tf, { width: 56, color: colors.infoText }]}>{fmtHrs(tableTotals.overtimeHours)}</Text>
                  <Text style={[styles.tf, { width: 64 }]} />
                  <Text style={[styles.tf, { width: 110 }]} />
                </View>
              )}
            </View>
          </ScrollView>
        </View>

        <View style={styles.tabBar}>
          <TouchableOpacity style={[styles.tabBtn, tab === 'day' && styles.tabBtnActive]} onPress={() => setTab('day')}>
            <Text style={[styles.tabText, tab === 'day' && styles.tabTextActive]}>Day Detail</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, tab === 'leave' && styles.tabBtnActive]} onPress={() => setTab('leave')}>
            <Text style={[styles.tabText, tab === 'leave' && styles.tabTextActive]}>Recent Leave</Text>
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
                        <Text style={styles.detailCellValue}>
                          {new Date(selectedDaySummary.checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        {selectedDaySummary.isLate && <Badge tone="warning">Late {formatHoursMinutes(selectedDaySummary.lateMinutes)}</Badge>}
                      </View>
                      <View style={[styles.detailCell, { backgroundColor: colors.warningBg }]}>
                        <Text style={[styles.detailCellLabel, { color: colors.warningText }]}>OUT</Text>
                        <Text style={styles.detailCellValue}>
                          {selectedDaySummary.checkOut ? new Date(selectedDaySummary.checkOut.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not yet'}
                        </Text>
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
      </ScrollView>

      <Modal visible={employeePickerOpen} transparent animationType="fade" onRequestClose={() => setEmployeePickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setEmployeePickerOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={employees}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    setEmployeeId(item.id);
                    setEmployeePickerOpen(false);
                  }}
                >
                  <Text style={styles.modalOptionText}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={tableEmployeeOpen} transparent animationType="fade" onRequestClose={() => setTableEmployeeOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setTableEmployeeOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={[{ id: 'all', name: 'All Employees' } as any, ...employees]}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    setTableEmployeeId(item.id);
                    setTableEmployeeOpen(false);
                  }}
                >
                  <Text style={[styles.modalOptionText, tableEmployeeId === item.id && { color: colors.accent, fontWeight: '700' }]}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={tableStatusOpen} transparent animationType="fade" onRequestClose={() => setTableStatusOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setTableStatusOpen(false)}>
          <View style={styles.modalSheet}>
            {TABLE_STATUS_OPTIONS.map(s => (
              <TouchableOpacity
                key={s}
                style={styles.modalOption}
                onPress={() => {
                  setTableStatus(s);
                  setTableStatusOpen(false);
                }}
              >
                <Text style={[styles.modalOptionText, tableStatus === s && { color: colors.accent, fontWeight: '700' }]}>{s === 'All' ? 'All Logs' : s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  employeePicker: { backgroundColor: colors.white, borderRadius: 16, padding: 14, marginBottom: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  employeePickerLabel: { fontSize: 10, color: colors.slate400, textTransform: 'uppercase', fontWeight: '700' },
  employeePickerValue: { fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: 3 },
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
  expandedDate: { fontSize: 14, color: colors.ink, fontWeight: '600' },
  dim: { fontSize: 12, color: colors.slate400 },
  tableSection: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 14,
    marginTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  tableSectionTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  tableFilterBar: { gap: 8, marginBottom: 10 },
  filterChipsRow: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.ink },
  exportBtn: { alignSelf: 'flex-end', borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentLight, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  exportBtnText: { fontSize: 12, fontWeight: '700', color: colors.accent },
  rawTableHeader: { flexDirection: 'row', backgroundColor: colors.slate50, borderBottomWidth: 1, borderBottomColor: colors.slate200, paddingVertical: 8, paddingHorizontal: 4, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  th: { fontSize: 9, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase', paddingHorizontal: 2 },
  tr: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  trAlt: { backgroundColor: colors.slate50 },
  td: { fontSize: 10, color: colors.slate500, paddingHorizontal: 2 },
  tdName: { color: colors.ink, fontWeight: '600' },
  footerRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 4, backgroundColor: colors.slate50, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  tf: { fontSize: 10, fontWeight: '700', color: colors.ink, paddingHorizontal: 2 },
  empty: { textAlign: 'center', marginTop: 20, marginBottom: 20, color: colors.slate400 },
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
  detailTitle: { fontSize: 17, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  leaveBanner: { backgroundColor: '#f3e8ff', borderRadius: 12, padding: 10, marginBottom: 10 },
  leaveBannerLabel: { fontSize: 11, fontWeight: '600', color: '#7e22ce' },
  leaveBannerType: { fontSize: 15, fontWeight: '700', color: colors.ink, textTransform: 'capitalize' },
  grid2: { flexDirection: 'row', gap: 10 },
  detailCell: { flex: 1, borderRadius: 12, padding: 10 },
  detailCellLabel: { fontSize: 11, fontWeight: '600' },
  detailCellValue: { fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 2, marginBottom: 4 },
  leaveRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.slate100 },
  leaveRowDate: { fontSize: 14, color: colors.ink },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  modalSheet: { backgroundColor: colors.white, borderRadius: 16, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
});
