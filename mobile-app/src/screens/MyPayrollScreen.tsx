import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { supabase } from '../lib/supabase';
import { formatHoursMinutes, nepalTodayIso, type DailyShiftByDate } from '../lib/shift';
import { buildEmployeeDayRows, dailySalaryEarning, type DayDetail } from '../lib/payrollDetail';
import type { AttendanceLog, Employee, PayrollSummary, Shift } from '../types';
import { colors } from '../theme';
import { ChevronIcon } from '../components/icons';
import SimpleLineChart from '../components/SimpleLineChart';

const OT_HOURS_PER_DAY = 8;
const OT_MULTIPLIER = 1.5;
const MONTH_LABEL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}
function monthBounds(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}
function fmtShort(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export default function MyPayrollScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());
  const { start, end } = useMemo(() => monthBounds(year, month), [year, month]);

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [lifetimeSummaries, setLifetimeSummaries] = useState<PayrollSummary[]>([]);
  const [lifetimeLogs, setLifetimeLogs] = useState<AttendanceLog[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ work_date: string; shift_id: string | null }[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setLoading(false);
      if (!profile?.employee_id) return;
      setEmployeeId(profile.employee_id);
      const [{ data: emp }, { data: shiftRows }] = await Promise.all([
        supabase.from('employees').select('*').eq('id', profile.employee_id).single(),
        supabase.from('shifts').select('*'),
      ]);
      setEmployee((emp as Employee) ?? null);
      setShifts((shiftRows as Shift[]) ?? []);
    });
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    supabase.from('payroll_summaries').select('*').eq('employee_id', employeeId).gte('work_date', start).lte('work_date', end).then(({ data }) => setSummaries((data as PayrollSummary[]) ?? []));
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('punch_time', `${start}T00:00:00Z`)
      .lte('punch_time', `${end}T23:59:59Z`)
      .then(({ data }) => setLogs((data as AttendanceLog[]) ?? []));
  }, [employeeId, start, end]);

  useEffect(() => {
    if (!employeeId || !employee?.date_of_joining) return;
    const from = employee.date_of_joining;
    const today = nepalTodayIso();
    supabase.from('payroll_summaries').select('*').eq('employee_id', employeeId).gte('work_date', from).lte('work_date', today).then(({ data }) => setLifetimeSummaries((data as PayrollSummary[]) ?? []));
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('punch_time', `${from}T00:00:00Z`)
      .then(({ data }) => setLifetimeLogs((data as AttendanceLog[]) ?? []));
    supabase.from('employee_daily_shifts').select('work_date, shift_id').eq('employee_id', employeeId).gte('work_date', from).lte('work_date', today).then(({ data }) => setDailyShiftRows((data as any) ?? []));
  }, [employeeId, employee?.date_of_joining]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    if (!employeeId) return map;
    const perDate = new Map<string, string | null>();
    for (const r of dailyShiftRows) perDate.set(r.work_date, r.shift_id);
    map.set(employeeId, perDate);
    return map;
  }, [dailyShiftRows, employeeId]);

  const dayRows: DayDetail[] = useMemo(() => (employee ? buildEmployeeDayRows(employee, shifts, summaries, logs, start, end, dailyShiftByDate) : []), [employee, shifts, summaries, logs, start, end, dailyShiftByDate]);
  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);

  const lifetimeDayRows: DayDetail[] = useMemo(
    () => (employee?.date_of_joining ? buildEmployeeDayRows(employee, shifts, lifetimeSummaries, lifetimeLogs, employee.date_of_joining, nepalTodayIso(), dailyShiftByDate) : []),
    [employee, shifts, lifetimeSummaries, lifetimeLogs, dailyShiftByDate]
  );

  const totalEarned = useMemo(() => {
    if (employee?.salary == null) return null;
    const byMonth = new Map<string, DayDetail[]>();
    for (const row of lifetimeDayRows) {
      const key = row.date.slice(0, 7);
      const list = byMonth.get(key);
      if (list) list.push(row);
      else byMonth.set(key, [row]);
    }
    let total = 0;
    for (const [key, rows] of byMonth) {
      const [y, m] = key.split('-').map(Number);
      const daysInMonth = new Date(y, m, 0).getDate();
      for (const row of rows) {
        const earning = dailySalaryEarning(row, employee.salary, daysInMonth, OT_HOURS_PER_DAY, OT_MULTIPLIER, true);
        if (earning) total += earning.total;
      }
    }
    return Math.round(total);
  }, [lifetimeDayRows, employee]);

  const totals = useMemo(() => {
    const totalHours = dayRows.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = dayRows.reduce((s, r) => s + r.overtime, 0);
    const presentDays = dayRows.filter(r => r.checkIn).length;
    const absentDays = dayRows.filter(r => r.status === 'Absent').length;
    let baseEarning = 0;
    let overtimeEarning = 0;
    for (const r of dayRows) {
      const earning = dailySalaryEarning(r, employee?.salary ?? null, daysInRange, OT_HOURS_PER_DAY, OT_MULTIPLIER, true);
      if (earning) {
        baseEarning += earning.base;
        overtimeEarning += earning.overtime;
      }
    }
    return { totalHours, overtimeHours, presentDays, absentDays, totalSalary: baseEarning + overtimeEarning, overtimeEarning };
  }, [dayRows, employee, daysInRange]);

  const received = employee?.salary != null ? Math.round(totals.totalSalary) : null;
  const receivedOvertime = Math.round(totals.overtimeEarning);

  function changeMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
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
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={{ padding: 16 }}
        data={dayRows}
        keyExtractor={item => item.date}
        ListHeaderComponent={
          <>
            {employee?.salary != null && (
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { backgroundColor: colors.goodBg }]}>
                  <Text style={[styles.statLabel, { color: colors.goodText }]}>Salary/Day</Text>
                  <Text style={styles.statValue}>{employee.salary.toLocaleString()}</Text>
                  <Text style={[styles.statHint, { color: colors.goodText }]}>{Math.round(employee.salary / daysInRange).toLocaleString()}/day</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: colors.infoBg }]}>
                  <Text style={[styles.statLabel, { color: colors.infoText }]}>Receivable</Text>
                  <Text style={styles.statValue}>{received != null ? received.toLocaleString() : '—'}</Text>
                  {received != null && <Text style={[styles.statHint, { color: colors.infoText }]}>(OT: {receivedOvertime.toLocaleString()})</Text>}
                </View>
                <View style={[styles.statCard, { backgroundColor: colors.warningBg }]}>
                  <Text style={[styles.statLabel, { color: colors.warningText }]}>Total Earned</Text>
                  <Text style={styles.statValue}>{totalEarned != null ? totalEarned.toLocaleString() : '—'}</Text>
                  <Text style={[styles.statHint, { color: colors.warningText }]}>till date</Text>
                </View>
              </View>
            )}

            <View style={styles.periodBar}>
              <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.periodArrow}>
                <View style={{ transform: [{ rotate: '90deg' }] }}>
                  <ChevronIcon size={16} color={colors.accent} />
                </View>
              </TouchableOpacity>
              <Text style={styles.periodLabel}>
                {MONTH_LABEL[month]} {year}
              </Text>
              <TouchableOpacity onPress={() => changeMonth(1)} style={styles.periodArrow}>
                <View style={{ transform: [{ rotate: '-90deg' }] }}>
                  <ChevronIcon size={16} color={colors.accent} />
                </View>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionHeading}>Daily Breakdown</Text>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, { flex: 0.15 }]}>Date</Text>
              <Text style={[styles.th, { flex: 0.15 }]}>Hrs</Text>
              <Text style={[styles.th, { flex: 0.15 }]}>OT</Text>
              <Text style={[styles.th, { flex: 0.2 }]}>Status</Text>
              <Text style={[styles.th, { flex: 0.35 }]}>Total (OT)</Text>
            </View>
          </>
        }
        renderItem={({ item: row, index }) => {
          const earning = row.checkIn ? dailySalaryEarning(row, employee?.salary ?? null, daysInRange, OT_HOURS_PER_DAY, OT_MULTIPLIER, true) : null;
          return (
            <View style={[styles.tr, index % 2 === 1 && styles.trAlt]}>
              <Text style={[styles.td, { flex: 0.15 }]}>{fmtShort(row.date)}</Text>
              <Text style={[styles.td, { flex: 0.15 }]}>{row.checkIn ? fmtHrs(row.hours) : '—'}</Text>
              <Text style={[styles.td, { flex: 0.15, color: colors.infoText }]}>{row.checkIn ? fmtHrs(row.overtime) : '—'}</Text>
              <Text style={[styles.td, { flex: 0.2 }, row.checkIn ? { color: colors.goodText } : row.status === 'Absent' ? { color: colors.criticalText } : styles.dim]}>
                {row.checkIn ? 'Present' : row.status === 'Absent' ? 'Absent' : '—'}
              </Text>
              <Text style={[styles.td, styles.tdBold, { flex: 0.35 }]}>
                {earning ? earning.total.toFixed(0) : '—'}
                {earning && earning.overtime > 0 ? <Text style={{ color: colors.infoText }}> ({earning.overtime.toFixed(0)})</Text> : null}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No attendance records for this month yet.</Text>}
        ListFooterComponent={
          dayRows.length > 0 ? (
            <>
              <View style={styles.footerRow}>
                <Text style={[styles.tf, { flex: 0.15 }]}>Total</Text>
                <Text style={[styles.tf, { flex: 0.15 }]}>{fmtHrs(totals.totalHours)}</Text>
                <Text style={[styles.tf, { flex: 0.15, color: colors.infoText }]}>{fmtHrs(totals.overtimeHours)}</Text>
                <Text style={[styles.tf, { flex: 0.2 }]}>
                  <Text style={{ color: colors.goodText }}>{totals.presentDays}P</Text> <Text style={{ color: colors.criticalText }}>{totals.absentDays}A</Text>
                </Text>
                <Text style={[styles.tf, { flex: 0.35, color: colors.goodText }]}>{Math.round(totals.totalSalary).toLocaleString()}</Text>
              </View>
              <View style={styles.chartCard}>
                <Text style={styles.sectionHeading}>Earning Trend</Text>
                <SimpleLineChart
                  color="#7c3aed"
                  data={dayRows.map(row => {
                    const earning = row.checkIn ? dailySalaryEarning(row, employee?.salary ?? null, daysInRange, OT_HOURS_PER_DAY, OT_MULTIPLIER, true) : null;
                    return { label: row.date.slice(8, 10), value: earning ? Math.round(earning.total) : 0 };
                  })}
                />
              </View>
            </>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { flex: 1, borderRadius: 10, padding: 10, alignItems: 'center' },
  statLabel: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  statValue: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 2 },
  statHint: { fontSize: 9, marginTop: 1 },
  periodBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: colors.slate200, padding: 8, marginBottom: 16 },
  periodArrow: { padding: 8 },
  periodLabel: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.ink },
  sectionHeading: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  chartCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 12, marginTop: 16 },
  tableHeader: { flexDirection: 'row', backgroundColor: colors.slate100, paddingVertical: 6, paddingHorizontal: 8, borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  th: { fontSize: 9, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase', textAlign: 'center' },
  tr: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  trAlt: { backgroundColor: colors.slate50 },
  td: { fontSize: 10, color: colors.slate500, textAlign: 'center' },
  tdBold: { fontWeight: '700', color: colors.goodText },
  dim: { color: colors.slate400 },
  footerRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 8, backgroundColor: colors.slate100, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  tf: { fontSize: 10, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  empty: { textAlign: 'center', marginTop: 20, color: colors.slate400 },
});
