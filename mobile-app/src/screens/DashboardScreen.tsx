import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, Employee, LeaveRequest, Shift } from '../types';
import { colors } from '../theme';
import StatCard from '../components/StatCard';
import { dateKey, isLate, presentEmployeeIds } from '../lib/metrics';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from '../lib/shift';

type EmployeeLite = Pick<Employee, 'name' | 'profile_photo_url'>;

export default function DashboardScreen({ navigation }: any) {
  const [feed, setFeed] = useState<AttendanceLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeLookup, setEmployeeLookup] = useState<Record<string, EmployeeLite>>({});
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [onLeave, setOnLeave] = useState<LeaveRequest[]>([]);
  const [todayRoster, setTodayRoster] = useState<{ employee_id: string; shift_id: string | null }[]>([]);
  const [weekLogs, setWeekLogs] = useState<AttendanceLog[]>([]);

  useEffect(() => {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);
    const today = nepalTodayIso();

    supabase
      .from('employees')
      .select('*')
      .then(({ data }) => {
        setEmployees((data as Employee[]) ?? []);
        const map: Record<string, EmployeeLite> = {};
        for (const e of data ?? []) map[e.id] = { name: e.name, profile_photo_url: e.profile_photo_url };
        setEmployeeLookup(map);
      });
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
    supabase
      .from('leave_requests')
      .select('*')
      .eq('status', 'approved')
      .lte('start_date', today)
      .gte('end_date', today)
      .then(({ data }) => setOnLeave((data as LeaveRequest[]) ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('employee_id, shift_id')
      .eq('work_date', today)
      .then(({ data }) => setTodayRoster(data ?? []));
    supabase
      .from('attendance_logs')
      .select('*')
      .gte('punch_time', since.toISOString())
      .order('punch_time', { ascending: false })
      .then(({ data }) => {
        const logs = (data as AttendanceLog[]) ?? [];
        setWeekLogs(logs);
        setFeed(logs.slice(0, 20));
      });

    const channel = supabase
      .channel('attendance-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
        payload => {
          const log = payload.new as AttendanceLog;
          setFeed(prev => [log, ...prev].slice(0, 20));
          setWeekLogs(prev => [log, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const activeEmployees = useMemo(() => employees.filter(e => e.status === 'active'), [employees]);
  const today = nepalTodayIso();
  const todayLogs = useMemo(() => weekLogs.filter(l => dateKey(l.punch_time) === today), [weekLogs, today]);
  const presentIds = useMemo(() => presentEmployeeIds(weekLogs, today), [weekLogs, today]);
  const onLeaveIds = useMemo(() => new Set(onLeave.map(l => l.employee_id)), [onLeave]);
  const attendancePct = activeEmployees.length ? Math.round((presentIds.size / activeEmployees.length) * 100) : 0;

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of todayRoster) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(today, r.shift_id);
    }
    return map;
  }, [todayRoster, today]);

  const lateCount = useMemo(() => {
    let count = 0;
    for (const emp of activeEmployees) {
      const empLogs = todayLogs.filter(l => l.employee_id === emp.id);
      if (!empLogs.length) continue;
      if (isLate(emp, shifts, empLogs, today, dailyShiftByDate)) count++;
    }
    return count;
  }, [activeEmployees, todayLogs, shifts, today, dailyShiftByDate]);

  const absentCount = useMemo(
    () => activeEmployees.filter(emp => !presentIds.has(emp.id) && !onLeaveIds.has(emp.id)).length,
    [activeEmployees, presentIds, onLeaveIds]
  );

  const todayDayStatus = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeDayStatusForResolvedShift>>();
    for (const emp of activeEmployees) {
      const empLogs = weekLogs.filter(l => l.employee_id === emp.id);
      if (empLogs.length === 0) continue;
      const byDate = new Map<string, AttendanceLog[]>();
      for (const log of empLogs) {
        const key = dateKey(log.punch_time);
        const list = byDate.get(key);
        if (list) list.push(log);
        else byDate.set(key, [log]);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate);
      const dayLogs = byDate.get(today);
      if (!dayLogs || dayLogs.length === 0) continue;
      const resolved = resolveShiftForDate(emp, shifts, today, dailyShiftByDate);
      map.set(emp.id, computeDayStatusForResolvedShift(dayLogs, resolved));
    }
    return map;
  }, [activeEmployees, weekLogs, shifts, dailyShiftByDate, today]);

  const todayWorkHours = useMemo(() => {
    let sum = 0;
    for (const status of todayDayStatus.values()) if (status.hasOut) sum += status.totalMinutes / 60;
    return sum;
  }, [todayDayStatus]);

  const todayOvertimeHours = useMemo(() => {
    let sum = 0;
    for (const status of todayDayStatus.values()) sum += status.overtimeMinutes / 60;
    return sum;
  }, [todayDayStatus]);

  return (
    <View style={styles.container}>
      <FlatList
        data={feed}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <View style={styles.statsGrid}>
              <StatCard label="Total Employees" value={String(activeEmployees.length)} hint="Active rosters" />
              <StatCard label="Present Today" value={String(presentIds.size)} hint={`${attendancePct}% attendance`} />
              <StatCard label="Late Arrivals" value={String(lateCount)} hint="Past grace period" />
              <StatCard label="On Leave" value={String(onLeaveIds.size)} hint="Approved today" />
              <StatCard label="Absent Today" value={String(absentCount)} hint="No punch, not on leave" />
              <StatCard label="Total Work Hours" value={todayWorkHours.toFixed(1)} hint="Today, all staff" />
              <StatCard label="Overtime" value={`${todayOvertimeHours.toFixed(1)} hrs`} hint="Today, all staff" />
            </View>
            <TouchableOpacity
              style={styles.viewLogsButton}
              onPress={() => navigation.getParent()?.navigate('Attendance' as never)}
            >
              <Text style={styles.viewLogsText}>View Full Logs</Text>
            </TouchableOpacity>
            <Text style={styles.heading}>Live Biometric Feed</Text>
          </>
        }
        renderItem={({ item }) => {
          const emp = employeeLookup[item.employee_id];
          const name = emp?.name ?? 'Unknown';
          const isIn = item.punch_type === '0';
          return (
            <View style={styles.row}>
              {emp?.profile_photo_url ? (
                <Image source={{ uri: emp.profile_photo_url }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{name}</Text>
                <Text style={styles.time}>
                  {new Date(item.punch_time).toLocaleTimeString()} · {item.method}
                </Text>
              </View>
              <View style={[styles.typeBadge, isIn ? styles.typeInBg : styles.typeOutBg]}>
                <Text style={isIn ? styles.typeInText : styles.typeOutText}>{isIn ? 'Check-in' : 'Check-out'}</Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No punches yet.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50, padding: 16 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  viewLogsButton: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16, marginTop: 4 },
  viewLogsText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  heading: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  list: { paddingBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  avatarImage: { height: 36, width: 36, borderRadius: 18, backgroundColor: colors.slate200 },
  avatar: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  name: { fontSize: 14, fontWeight: '600', color: colors.ink },
  time: { fontSize: 12, color: colors.slate500, marginTop: 1 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeInBg: { backgroundColor: colors.goodBg },
  typeOutBg: { backgroundColor: colors.infoBg },
  typeInText: { fontSize: 11, fontWeight: '700', color: colors.goodText },
  typeOutText: { fontSize: 11, fontWeight: '700', color: colors.infoText },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
});
