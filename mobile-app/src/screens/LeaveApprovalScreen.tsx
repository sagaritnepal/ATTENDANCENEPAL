import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Employee, LeaveRequest } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';

const FILTERS = ['pending', 'approved', 'rejected', 'All'] as const;

function daysBetween(start: string, end: string) {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
}

export default function LeaveApprovalScreen() {
  const { system } = useCalendarSystem();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  function reload() {
    supabase.from('leave_requests').select('*').order('created_at', { ascending: false }).then(({ data }) => setRequests((data as LeaveRequest[]) ?? []));
    supabase.from('employees').select('*').then(({ data }) => setEmployees((data as Employee[]) ?? []));
  }
  useEffect(reload, []);

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';
  const filtered = useMemo(() => (filter === 'All' ? requests : requests.filter(r => r.status === filter)), [requests, filter]);

  async function review(id: string, status: 'approved' | 'rejected') {
    setBusyId(id);
    const { data } = await supabase.auth.getUser();
    await supabase.from('leave_requests').update({ status, reviewed_by: data.user?.id, reviewed_at: new Date().toISOString() }).eq('id', id);
    setBusyId(null);
    reload();
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item: r }) => (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{employeeName(r.employee_id)}</Text>
                <Text style={styles.type}>{r.leave_type}</Text>
              </View>
              <Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'critical' : 'warning'}>{r.status}</Badge>
            </View>
            <Text style={styles.dates}>
              {formatAdDate(r.start_date, system)} → {formatAdDate(r.end_date, system)} <Text style={styles.dim}>· {daysBetween(r.start_date, r.end_date)}d</Text>
            </Text>
            {r.reason ? <Text style={styles.reason}>{r.reason}</Text> : null}
            {r.status === 'pending' && (
              <View style={styles.actions}>
                <TouchableOpacity disabled={busyId === r.id} style={styles.approveBtn} onPress={() => review(r.id, 'approved')}>
                  <Text style={styles.approveText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={busyId === r.id} style={styles.rejectBtn} onPress={() => review(r.id, 'rejected')}>
                  <Text style={styles.rejectText}>Reject</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No {filter !== 'All' ? filter : ''} leave requests.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  filterBar: { flexDirection: 'row', gap: 8, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.slate200, padding: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.slate500, textTransform: 'capitalize' },
  chipTextActive: { color: colors.white },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.slate200 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  name: { fontSize: 14, fontWeight: '700', color: colors.ink },
  type: { fontSize: 11, color: colors.slate500, textTransform: 'capitalize', marginTop: 2 },
  dates: { fontSize: 13, color: colors.slate500, marginTop: 8 },
  dim: { color: colors.slate400 },
  reason: { fontSize: 12, color: colors.slate500, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  approveBtn: { backgroundColor: colors.good, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  approveText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  rejectBtn: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  rejectText: { color: colors.slate500, fontSize: 12, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
});
