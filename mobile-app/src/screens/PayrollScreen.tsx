import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity, Switch, Modal } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, Employee, PayrollSummary, Shift } from '../types';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from '../lib/shift';
import { colors } from '../theme';
import { ChevronIcon } from '../components/icons';

function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}
function monthBounds(year: number, month: number) {
  const start = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}
const MONTH_LABEL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Row = {
  id: string;
  enrollId: string;
  name: string;
  salary: number | null;
  days: number;
  hours: number;
  overtime: number;
  lateDays: number;
  earlyDays: number;
};

export default function PayrollScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth());
  const { start, end } = useMemo(() => monthBounds(year, month), [year, month]);

  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingSalary, setPendingSalary] = useState<Record<string, string>>({});
  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [otHoursPerDay, setOtHoursPerDay] = useState('8');
  const [otMultiplier, setOtMultiplier] = useState('1.5');
  const [overtimeEnabled, setOvertimeEnabled] = useState<Record<string, boolean>>({});
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);

  function reload() {
    setLoading(true);
    Promise.all([
      supabase.from('payroll_summaries').select('*').gte('work_date', start).lte('work_date', end),
      supabase.from('attendance_logs').select('*').gte('punch_time', `${start}T00:00:00Z`).lte('punch_time', `${end}T23:59:59Z`),
      supabase.from('shifts').select('*'),
      supabase.from('employees').select('*').eq('status', 'active'),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', start).lte('work_date', end),
    ]).then(([summariesRes, logsRes, shiftsRes, employeesRes, rosterRes]) => {
      setSummaries((summariesRes.data as PayrollSummary[]) ?? []);
      setLogs((logsRes.data as AttendanceLog[]) ?? []);
      setShifts((shiftsRes.data as Shift[]) ?? []);
      setEmployees((employeesRes.data as Employee[]) ?? []);
      setDailyShiftRows((rosterRes.data as any) ?? []);
      setLoading(false);
    });
  }
  useEffect(reload, [start, end]);

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of dailyShiftRows) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(r.work_date, r.shift_id);
    }
    return map;
  }, [dailyShiftRows]);

  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);
  const elapsedDaysInRange = useMemo(() => {
    const today = nepalTodayIso();
    const elapsedEnd = end < today ? end : today;
    return start > elapsedEnd ? 0 : (new Date(elapsedEnd).getTime() - new Date(start).getTime()) / 86400000 + 1;
  }, [start, end]);

  const byEmployee: Row[] = useMemo(() => {
    const days: string[] = [];
    const cur = new Date(start + 'T00:00:00Z');
    const endDate = new Date(end + 'T00:00:00Z');
    while (cur <= endDate) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const map = new Map<string, Row>();
    for (const emp of employees) {
      map.set(emp.id, { id: emp.id, enrollId: emp.fingerprint_id ?? '—', name: emp.name, salary: emp.salary, days: 0, hours: 0, overtime: 0, lateDays: 0, earlyDays: 0 });
    }
    const today = nepalTodayIso();
    const logsByEmployeeDay = new Map<string, Map<string, AttendanceLog[]>>();
    for (const emp of employees) {
      const empLogs = logs.filter(l => l.employee_id === emp.id);
      const byDate = new Map<string, AttendanceLog[]>();
      for (const day of days) {
        const dayLogs = empLogs.filter(l => l.punch_time.slice(0, 10) === day);
        if (dayLogs.length > 0) byDate.set(day, dayLogs);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate);
      logsByEmployeeDay.set(emp.id, byDate);
    }
    for (const day of days) {
      for (const emp of employees) {
        const row = map.get(emp.id);
        if (!row) continue;
        const summary = day === today ? undefined : summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        if (summary) {
          row.days += 1;
          row.hours += Number(summary.total_hours);
          row.overtime += Number(summary.overtime_hours);
          if (summary.is_late) row.lateDays += 1;
          if (summary.is_early_departure) row.earlyDays += 1;
          continue;
        }
        const dayLogs = (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        if (dayLogs.length === 0) continue;
        const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate);
        const live = computeDayStatusForResolvedShift(dayLogs, resolved);
        row.days += 1;
        row.hours += live.totalMinutes / 60;
        row.overtime += live.overtimeMinutes / 60;
        if (live.isLate) row.lateDays += 1;
        if (live.isEarly) row.earlyDays += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.enrollId.localeCompare(b.enrollId, undefined, { numeric: true, sensitivity: 'base' }));
  }, [summaries, logs, shifts, employees, start, end, dailyShiftByDate]);

  const otHours = Number(otHoursPerDay) || 0;
  const otMult = Number(otMultiplier) || 0;

  function calculatedSalary(row: Row): number | null {
    if (row.salary == null || !otHours) return null;
    const hourlyRate = row.salary / (daysInRange * otHours);
    const regularHours = Math.max(0, row.hours - row.overtime);
    return Math.round(hourlyRate * regularHours);
  }
  function overtimeSalary(row: Row): number | null {
    if (row.salary == null || !otHours) return null;
    if (row.overtime <= 0 || !(overtimeEnabled[row.id] ?? true)) return 0;
    const hourlyRate = row.salary / (daysInRange * otHours);
    return Math.round(hourlyRate * otMult * row.overtime);
  }
  function totalSalary(row: Row): number | null {
    const calculated = calculatedSalary(row);
    if (calculated == null) return null;
    return calculated + (overtimeSalary(row) ?? 0);
  }

  const totals = useMemo(() => {
    const totalHours = byEmployee.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = byEmployee.reduce((s, r) => s + r.overtime, 0);
    const workedDays = byEmployee.reduce((s, r) => s + r.days, 0);
    const possibleDays = employees.length * elapsedDaysInRange;
    const absentDays = Math.max(0, possibleDays - workedDays);
    const attendancePct = possibleDays ? Math.round((workedDays / possibleDays) * 1000) / 10 : 0;
    const totalEmployeeSalary = byEmployee.reduce((s, r) => s + (r.salary ?? 0), 0);
    const totalSalaryPayable = byEmployee.reduce((s, r) => s + (calculatedSalary(r) ?? 0), 0);
    const totalOvertimeSalary = byEmployee.reduce((s, r) => s + (overtimeSalary(r) ?? 0), 0);
    return { totalHours, overtimeHours, workedDays, absentDays, attendancePct, totalEmployeeSalary, totalSalaryPayable, totalOvertimeSalary };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byEmployee, employees.length, elapsedDaysInRange, otHours, otMult, overtimeEnabled]);

  async function saveSalaryRow(employeeId: string) {
    const draft = pendingSalary[employeeId];
    if (draft === undefined) return;
    setSavingRowId(employeeId);
    const { error } = await supabase.from('employees').update({ salary: draft ? Number(draft) : null }).eq('id', employeeId);
    setSavingRowId(null);
    if (error) return;
    setPendingSalary(p => {
      const next = { ...p };
      delete next[employeeId];
      return next;
    });
    setEditingSalaryId(null);
    reload();
  }

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

  if (loading && byEmployee.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={byEmployee}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListHeaderComponent={
          <>
            <View style={styles.statsGrid}>
              <View style={[styles.statCard, { backgroundColor: colors.warningBg }]}>
                <Text style={[styles.statLabel, { color: colors.warningText }]}>Overtime Salary</Text>
                <Text style={[styles.statValue, { color: colors.warningText }]}>{Math.round(totals.totalOvertimeSalary).toLocaleString()}</Text>
                <View style={styles.otInputsRow}>
                  <TextInput style={styles.otInput} value={otHoursPerDay} onChangeText={setOtHoursPerDay} keyboardType="numeric" />
                  <Text style={styles.otInputLabel}>h/day ×</Text>
                  <TextInput style={styles.otInput} value={otMultiplier} onChangeText={setOtMultiplier} keyboardType="numeric" />
                  <Text style={styles.otInputLabel}>x</Text>
                </View>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.goodBg }]}>
                <Text style={[styles.statLabel, { color: colors.goodText }]}>Total Salary Payable</Text>
                <Text style={[styles.statValue, { color: colors.goodText }]}>{Math.round(totals.totalSalaryPayable).toLocaleString()}</Text>
                <Text style={[styles.statHint, { color: colors.goodText }]}>Earned so far this period</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.infoBg }]}>
                <Text style={[styles.statLabel, { color: colors.infoText }]}>Total Employees Salary</Text>
                <Text style={[styles.statValue, { color: colors.infoText }]}>{Math.round(totals.totalEmployeeSalary).toLocaleString()}</Text>
                <Text style={[styles.statHint, { color: colors.infoText }]}>Full monthly salary, all staff</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: colors.accentLight }]}>
                <Text style={[styles.statLabel, { color: colors.accent }]}>Total Payable Hours</Text>
                <Text style={[styles.statValue, { color: colors.accent }]}>{fmtHrs(totals.totalHours)}</Text>
                <Text style={[styles.statHint, { color: colors.accent }]}>Across {employees.length} staff</Text>
              </View>
              <View
                style={[
                  styles.statCard,
                  { backgroundColor: totals.attendancePct >= 75 ? colors.goodBg : totals.attendancePct >= 50 ? colors.warningBg : colors.criticalBg },
                ]}
              >
                <Text style={[styles.statLabel, { color: totals.attendancePct >= 75 ? colors.goodText : totals.attendancePct >= 50 ? colors.warningText : colors.criticalText }]}>
                  Avg Attendance
                </Text>
                <Text style={[styles.statValue, { color: totals.attendancePct >= 75 ? colors.goodText : totals.attendancePct >= 50 ? colors.warningText : colors.criticalText }]}>
                  {totals.attendancePct}%
                </Text>
                <Text style={[styles.statHint, { color: totals.attendancePct >= 75 ? colors.goodText : totals.attendancePct >= 50 ? colors.warningText : colors.criticalText }]}>
                  Worked vs possible days
                </Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: '#f3e8ff' }]}>
                <Text style={[styles.statLabel, { color: '#7e22ce' }]}>Overtime Tracked</Text>
                <Text style={[styles.statValue, { color: '#7e22ce' }]}>{fmtHrs(totals.overtimeHours)}</Text>
                <Text style={[styles.statHint, { color: '#7e22ce' }]}>This period</Text>
              </View>
            </View>

            <View style={styles.periodBar}>
              <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.periodArrow}>
                <View style={{ transform: [{ rotate: '90deg' }] }}>
                  <ChevronIcon size={16} color={colors.accent} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setMonthPickerOpen(true)} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.periodLabel}>
                  {MONTH_LABEL[month]} {year}
                </Text>
                <Text style={styles.periodSub}>
                  {start} to {end} ({daysInRange}d)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeMonth(1)} style={styles.periodArrow}>
                <View style={{ transform: [{ rotate: '-90deg' }] }}>
                  <ChevronIcon size={16} color={colors.accent} />
                </View>
              </TouchableOpacity>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  ID {item.enrollId} · {item.days}d · {item.lateDays}L · {item.earlyDays}E
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.totalLabel}>Total Salary</Text>
                <Text style={styles.totalValue}>{totalSalary(item) != null ? totalSalary(item)!.toLocaleString() : '—'}</Text>
              </View>
            </View>

            <View style={styles.grid2}>
              <View style={styles.gridCell}>
                <Text style={styles.gridLabel}>Total Hours</Text>
                <Text style={styles.gridValue}>{fmtHrs(item.hours)}</Text>
              </View>
              <View style={styles.gridCell}>
                <Text style={styles.gridLabel}>Overtime</Text>
                <Text style={styles.gridValue}>{fmtHrs(item.overtime)}</Text>
              </View>
              <View style={styles.gridCell}>
                <Text style={styles.gridLabel}>Salary</Text>
                {editingSalaryId === item.id ? (
                  <View style={{ gap: 4 }}>
                    <TextInput
                      style={styles.salaryInput}
                      keyboardType="numeric"
                      autoFocus
                      value={pendingSalary[item.id] ?? (item.salary != null ? String(item.salary) : '')}
                      onChangeText={v => setPendingSalary(p => ({ ...p, [item.id]: v }))}
                    />
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <TouchableOpacity onPress={() => setEditingSalaryId(null)}>
                        <Text style={styles.cancelLink}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => saveSalaryRow(item.id)} disabled={savingRowId === item.id}>
                        <Text style={styles.saveLink}>{savingRowId === item.id ? 'Saving…' : 'Save'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setEditingSalaryId(item.id)}>
                    <Text style={styles.gridValue}>{item.salary != null ? item.salary.toLocaleString() : '— (tap to set)'}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.gridCell}>
                <Text style={styles.gridLabel}>Calculated Salary</Text>
                <Text style={styles.gridValue}>
                  {calculatedSalary(item) != null ? calculatedSalary(item)!.toLocaleString() : '—'}
                  {overtimeSalary(item) != null ? <Text style={styles.dim}> ({overtimeSalary(item)!.toLocaleString()})</Text> : null}
                </Text>
              </View>
            </View>

            <View style={styles.otRow}>
              <Text style={styles.gridLabel}>Overtime Salary</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Switch
                  value={overtimeEnabled[item.id] ?? true}
                  onValueChange={v => setOvertimeEnabled(m => ({ ...m, [item.id]: v }))}
                  trackColor={{ false: colors.slate200, true: colors.good }}
                />
                <Text style={styles.gridValue}>{overtimeSalary(item) != null ? overtimeSalary(item)!.toLocaleString() : '—'}</Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{loading ? 'Loading…' : 'No active employees.'}</Text>}
        ListFooterComponent={
          byEmployee.length > 0 ? (
            <View style={styles.footerBar}>
              <Text style={{ color: colors.goodText, fontWeight: '700', fontSize: 12 }}>{totals.workedDays} present days</Text>
              <Text style={{ color: colors.slate400 }}> · </Text>
              <Text style={{ color: colors.criticalText, fontWeight: '700', fontSize: 12 }}>{totals.absentDays} absent days</Text>
            </View>
          ) : null
        }
      />

      <Modal visible={monthPickerOpen} transparent animationType="fade" onRequestClose={() => setMonthPickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setMonthPickerOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={MONTH_LABEL}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    setMonth(index);
                    setMonthPickerOpen(false);
                  }}
                >
                  <Text style={[styles.modalOptionText, index === month && { color: colors.accent, fontWeight: '700' }]}>
                    {item} {year}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  statCard: { flexBasis: '48%', borderRadius: 12, padding: 12, marginBottom: 10 },
  statLabel: { fontSize: 11, fontWeight: '600' },
  statValue: { fontSize: 17, fontWeight: '700', marginTop: 4 },
  statHint: { fontSize: 10, marginTop: 2, opacity: 0.8 },
  otInputsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  otInput: { width: 32, borderWidth: 1, borderColor: colors.warning, borderRadius: 4, backgroundColor: colors.white, textAlign: 'center', fontSize: 10, color: colors.warningText, paddingVertical: 2 },
  otInputLabel: { fontSize: 10, color: colors.warningText },
  periodBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 10, marginBottom: 12 },
  periodArrow: { padding: 8 },
  periodLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  periodSub: { fontSize: 10, color: colors.slate400, marginTop: 2 },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.slate200 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { fontSize: 14, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 11, color: colors.slate500, marginTop: 2 },
  totalLabel: { fontSize: 10, color: colors.slate400, textTransform: 'uppercase' },
  totalValue: { fontSize: 16, fontWeight: '700', color: colors.goodText },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.slate200 },
  gridCell: { width: '50%', marginBottom: 8 },
  gridLabel: { fontSize: 10, color: colors.slate400, textTransform: 'uppercase' },
  gridValue: { fontSize: 13, color: colors.ink, marginTop: 2 },
  dim: { color: colors.slate400, fontSize: 11 },
  salaryInput: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13, color: colors.ink, width: 100 },
  cancelLink: { fontSize: 11, color: colors.slate500, fontWeight: '600' },
  saveLink: { fontSize: 11, color: colors.accent, fontWeight: '700' },
  otRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
  footerBar: { flexDirection: 'row', justifyContent: 'center', paddingVertical: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
});
