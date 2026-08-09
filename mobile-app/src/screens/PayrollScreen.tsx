import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Employee, PayrollSummary } from '../types';

// A simplified monthly view (total hours/overtime worked, flat monthly
// salary for reference) — not the full prorated/OT-multiplier calculation
// the web Payroll page does. That logic (dailySalaryEarning, AD/BS period
// handling, editable OT rate) is a bigger lift intentionally left for a
// follow-up; this gives admins a quick read on the phone in the meantime.
function monthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  return { start, end };
}

function fmtHours(h: number) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins}m`;
}

export default function PayrollScreen() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const { start, end } = useMemo(monthRange, []);

  useEffect(() => {
    Promise.all([
      supabase.from('employees').select('*').eq('status', 'active').order('name'),
      supabase.from('payroll_summaries').select('*').gte('work_date', start).lte('work_date', end),
    ]).then(([empRes, sumRes]) => {
      setEmployees((empRes.data as Employee[]) ?? []);
      setSummaries((sumRes.data as PayrollSummary[]) ?? []);
      setLoading(false);
    });
  }, [start, end]);

  const rows = useMemo(() => {
    return employees.map(emp => {
      const own = summaries.filter(s => s.employee_id === emp.id);
      const hours = own.reduce((sum, s) => sum + Number(s.total_hours), 0);
      const overtime = own.reduce((sum, s) => sum + Number(s.overtime_hours), 0);
      const presentDays = own.length;
      const lateDays = own.filter(s => s.is_late).length;
      return { ...emp, hours, overtime, presentDays, lateDays };
    });
  }, [employees, summaries]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.periodLabel}>
        {new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · Month to date
      </Text>
      <FlatList
        data={rows}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.salary}>{item.salary != null ? item.salary.toLocaleString() : '—'}</Text>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Present</Text>
                <Text style={styles.statValue}>{item.presentDays}d</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Hours</Text>
                <Text style={styles.statValue}>{fmtHours(item.hours)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Overtime</Text>
                <Text style={[styles.statValue, { color: '#0d9488' }]}>{fmtHours(item.overtime)}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statLabel}>Late</Text>
                <Text style={[styles.statValue, item.lateDays > 0 && { color: '#d97706' }]}>{item.lateDays}d</Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No active employees.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  periodLabel: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  list: { padding: 16, paddingTop: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  name: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  salary: { fontSize: 14, fontWeight: '700', color: '#16a34a' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statLabel: { fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 2 },
  statValue: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  empty: { textAlign: 'center', marginTop: 40, color: '#94a3b8' },
});
