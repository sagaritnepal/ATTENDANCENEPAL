import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TouchableOpacity, Modal } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import type { AttendanceLog, Employee, PayrollSummary, Shift } from '../types';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  isWeekOff,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from '../lib/shift';
import { colors } from '../theme';

type Row = {
  key: string;
  date: string;
  employeeName: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming';
  lateMinutes: number;
  earlyMinutes: number;
  overtime: number;
};

function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}
function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '–:–';
}
function fmtDate(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const RANGE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: '7 Days', days: 6 },
  { label: '30 Days', days: 29 },
];
const STATUS_OPTIONS = ['All', 'Present', 'Absent', 'Late', 'Early'] as const;

export default function HistoryScreen() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'hr';

  const [from, setFrom] = useState(isoDaysAgo(6));
  const [to] = useState(isoDaysAgo(0));
  const [rangeLabel, setRangeLabel] = useState('7 Days');
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('All');
  const [statusOpen, setStatusOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('all');
  const [employeeOpen, setEmployeeOpen] = useState(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isAdmin) {
      supabase.from('employees').select('*').eq('status', 'active').order('name').then(({ data }) => setEmployees((data as Employee[]) ?? []));
    }
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
  }, [isAdmin]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('payroll_summaries').select('*').gte('work_date', from).lte('work_date', to),
      supabase.from('attendance_logs').select('*').gte('punch_time', `${from}T00:00:00Z`).lte('punch_time', `${to}T23:59:59Z`),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', from).lte('work_date', to),
    ]).then(([summariesRes, logsRes, rosterRes]) => {
      setSummaries((summariesRes.data as PayrollSummary[]) ?? []);
      setLogs((logsRes.data as AttendanceLog[]) ?? []);
      setDailyShiftRows((rosterRes.data as any) ?? []);
      setLoading(false);
    });
  }, [from, to]);

  const scopedEmployees = useMemo(
    () => (employeeId === 'all' ? employees : employees.filter(e => e.id === employeeId)),
    [employees, employeeId]
  );
  // Employee-role users only ever see their own rows via RLS — there's no
  // employees table access to resolve a shift against, so build a
  // single-employee list from their own profile's linked employee record.
  const selfEmployee = useMemo(() => {
    if (isAdmin || !profile?.employee_id) return null;
    return employees.find(e => e.id === profile.employee_id) ?? null;
  }, [isAdmin, profile, employees]);

  useEffect(() => {
    if (!isAdmin && profile?.employee_id) {
      supabase
        .from('employees')
        .select('*')
        .eq('id', profile.employee_id)
        .then(({ data }) => setEmployees((data as Employee[]) ?? []));
    }
  }, [isAdmin, profile]);

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

  const rows: Row[] = useMemo(() => {
    const activeEmployees = isAdmin ? scopedEmployees : selfEmployee ? [selfEmployee] : [];
    const days: string[] = [];
    const cur = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const today = nepalTodayIso();

    const logsByEmployeeDay = new Map<string, Map<string, AttendanceLog[]>>();
    for (const emp of activeEmployees) {
      const empLogs = logs.filter(l => l.employee_id === emp.id);
      const byDate = new Map<string, AttendanceLog[]>();
      for (const day of days) {
        const dayLogs = empLogs.filter(l => l.punch_time.slice(0, 10) === day);
        if (dayLogs.length > 0) byDate.set(day, dayLogs);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate);
      logsByEmployeeDay.set(emp.id, byDate);
    }

    const out: Row[] = [];
    for (const day of days) {
      for (const emp of activeEmployees) {
        const summary = day === today ? undefined : summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        const dayLogs = (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate);

        if (summary) {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            employeeName: emp.name,
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
            employeeName: emp.name,
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
            employeeName: emp.name,
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
      .filter(r => status === 'All' || (status === 'Early' ? r.earlyMinutes > 0 : r.status === status))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [isAdmin, scopedEmployees, selfEmployee, summaries, logs, shifts, from, to, status, dailyShiftByDate]);

  const totals = useMemo(() => {
    const workHours = rows.reduce((sum, r) => sum + r.hours, 0);
    const overtimeHours = rows.reduce((sum, r) => sum + r.overtime, 0);
    const lateMinutes = rows.reduce((sum, r) => sum + r.lateMinutes, 0);
    const earlyMinutes = rows.reduce((sum, r) => sum + r.earlyMinutes, 0);
    const presentDays = rows.filter(r => r.checkIn).length;
    const absentDays = rows.filter(r => !r.checkIn && r.status !== 'Upcoming').length;
    return { workHours, overtimeHours, lateMinutes, earlyMinutes, presentDays, absentDays };
  }, [rows]);

  if (loading && rows.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        <View style={styles.presetRow}>
          {RANGE_PRESETS.map(p => (
            <TouchableOpacity
              key={p.label}
              style={[styles.presetBtn, rangeLabel === p.label && styles.presetBtnActive]}
              onPress={() => {
                setFrom(isoDaysAgo(p.days));
                setRangeLabel(p.label);
              }}
            >
              <Text style={[styles.presetText, rangeLabel === p.label && styles.presetTextActive]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.filterChipsRow}>
          {isAdmin && (
            <TouchableOpacity style={styles.chip} onPress={() => setEmployeeOpen(true)}>
              <Text style={styles.chipText} numberOfLines={1}>
                {employeeId === 'all' ? 'All Employees' : employees.find(e => e.id === employeeId)?.name ?? 'Employee'}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.chip} onPress={() => setStatusOpen(true)}>
            <Text style={styles.chipText}>{status === 'All' ? 'All Logs' : status}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.tableHeader}>
        {isAdmin && <Text style={[styles.th, { flex: 0.26 }]}>Employee</Text>}
        <Text style={[styles.th, { flex: 0.12 }]}>Date</Text>
        <Text style={[styles.th, { flex: 0.2 }]}>In / Out</Text>
        <Text style={[styles.th, { flex: 0.17 }]}>Late/Early</Text>
        <Text style={[styles.th, { flex: 0.11 }]}>Status</Text>
        <Text style={[styles.th, { flex: 0.1 }]}>OT</Text>
        <Text style={[styles.th, { flex: 0.1 }]}>Hrs</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={item => item.key}
        renderItem={({ item, index }) => (
          <View style={[styles.tr, index % 2 === 1 && styles.trAlt]}>
            {isAdmin && (
              <Text style={[styles.td, styles.tdName, { flex: 0.26 }]} numberOfLines={1}>
                {item.employeeName}
              </Text>
            )}
            <Text style={[styles.td, { flex: 0.12 }]}>{fmtDate(item.date)}</Text>
            <Text style={[styles.td, { flex: 0.2 }]}>
              {fmtTime(item.checkIn)}-{fmtTime(item.checkOut)}
            </Text>
            <Text style={[styles.td, { flex: 0.17 }]}>
              {item.lateMinutes === 0 && item.earlyMinutes === 0 && <Text style={styles.dim}>—</Text>}
              {item.lateMinutes > 0 && <Text style={{ color: colors.warningText }}>L{formatHoursMinutes(item.lateMinutes)}</Text>}
              {item.earlyMinutes > 0 && <Text style={{ color: colors.criticalText }}> E{formatHoursMinutes(item.earlyMinutes)}</Text>}
            </Text>
            <Text style={[styles.td, { flex: 0.11 }, item.checkIn ? { color: colors.goodText } : item.status === 'Upcoming' ? styles.dim : { color: colors.criticalText }]}>
              {item.checkIn ? 'Present' : item.status === 'Upcoming' ? 'Upcoming' : 'Absent'}
            </Text>
            <Text style={[styles.td, { flex: 0.1, color: colors.infoText }]}>{fmtHrs(item.overtime)}</Text>
            <Text style={[styles.td, { flex: 0.1 }]}>{fmtHrs(item.hours)}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No records in this range.</Text>}
        ListFooterComponent={
          rows.length > 0 ? (
            <View style={styles.footerRow}>
              {isAdmin && <Text style={[styles.tf, { flex: 0.26 }]}>Total</Text>}
              <Text style={[styles.tf, { flex: 0.12 }]} />
              <Text style={[styles.tf, { flex: 0.2 }]}>
                <Text style={{ color: colors.goodText }}>{totals.presentDays}P</Text> / <Text style={{ color: colors.criticalText }}>{totals.absentDays}A</Text>
              </Text>
              <Text style={[styles.tf, { flex: 0.17 }]}>
                {totals.lateMinutes > 0 && <Text style={{ color: colors.warningText }}>L{formatHoursMinutes(totals.lateMinutes)}</Text>}
                {totals.earlyMinutes > 0 && <Text style={{ color: colors.criticalText }}> E{formatHoursMinutes(totals.earlyMinutes)}</Text>}
                {totals.lateMinutes === 0 && totals.earlyMinutes === 0 && '—'}
              </Text>
              <Text style={[styles.tf, { flex: 0.11 }]} />
              <Text style={[styles.tf, { flex: 0.1, color: colors.infoText }]}>{fmtHrs(totals.overtimeHours)}</Text>
              <Text style={[styles.tf, { flex: 0.1 }]}>{fmtHrs(totals.workHours)}</Text>
            </View>
          ) : null
        }
      />

      {isAdmin && (
        <Modal visible={employeeOpen} transparent animationType="fade" onRequestClose={() => setEmployeeOpen(false)}>
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setEmployeeOpen(false)}>
            <View style={styles.modalSheet}>
              <FlatList
                data={[{ id: 'all', name: 'All Employees' } as any, ...employees]}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => {
                      setEmployeeId(item.id);
                      setEmployeeOpen(false);
                    }}
                  >
                    <Text style={[styles.modalOptionText, employeeId === item.id && { color: colors.accent, fontWeight: '700' }]}>
                      {item.name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      <Modal visible={statusOpen} transparent animationType="fade" onRequestClose={() => setStatusOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setStatusOpen(false)}>
          <View style={styles.modalSheet}>
            {STATUS_OPTIONS.map(s => (
              <TouchableOpacity
                key={s}
                style={styles.modalOption}
                onPress={() => {
                  setStatus(s);
                  setStatusOpen(false);
                }}
              >
                <Text style={[styles.modalOptionText, status === s && { color: colors.accent, fontWeight: '700' }]}>
                  {s === 'All' ? 'All Logs' : s}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.white },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.white },
  filterBar: { backgroundColor: colors.slate50, borderBottomWidth: 1, borderBottomColor: colors.slate200, padding: 12, gap: 8 },
  presetRow: { flexDirection: 'row', gap: 8 },
  presetBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  presetBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  presetText: { fontSize: 12, fontWeight: '600', color: colors.slate500 },
  presetTextActive: { color: colors.white },
  filterChipsRow: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.ink },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: colors.slate50,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate200,
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  th: { fontSize: 9, fontWeight: '700', color: colors.slate500, textTransform: 'uppercase' },
  tr: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  trAlt: { backgroundColor: colors.slate50 },
  td: { fontSize: 10, color: colors.slate500 },
  tdName: { color: colors.ink, fontWeight: '600' },
  dim: { color: colors.slate400 },
  footerRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6, backgroundColor: colors.slate50, borderTopWidth: 2, borderTopColor: colors.slate200 },
  tf: { fontSize: 10, fontWeight: '700', color: colors.ink },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
});
