import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, FlatList, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import type { LeaveRequest, LeaveType } from '../types';

const LEAVE_TYPES: LeaveType[] = ['casual', 'sick', 'annual', 'unpaid'];

export default function LeaveRequestScreen() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveType, setLeaveType] = useState<LeaveType>('casual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  function reload(empId: string) {
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setRequests((data as LeaveRequest[]) ?? []);
        setLoading(false);
      });
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      if (profile?.employee_id) {
        setEmployeeId(profile.employee_id);
        reload(profile.employee_id);
      } else {
        setLoading(false);
      }
    });
  }, []);

  async function handleSubmit() {
    if (!employeeId) return Alert.alert('No employee linked to this account');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return Alert.alert('Use YYYY-MM-DD for both dates');
    }
    setSubmitting(true);
    const { error } = await supabase.from('leave_requests').insert({
      employee_id: employeeId,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason: reason || null,
    });
    setSubmitting(false);
    if (error) return Alert.alert('Request failed', error.message);
    setStartDate('');
    setEndDate('');
    setReason('');
    reload(employeeId);
    Alert.alert('Submitted', 'Your leave request is pending approval.');
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.form}>
          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {LEAVE_TYPES.map(t => (
              <Text
                key={t}
                onPress={() => setLeaveType(t)}
                style={[styles.typeChip, leaveType === t && styles.typeChipActive]}
              >
                {t}
              </Text>
            ))}
          </View>
          <Text style={styles.label}>Start date (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={startDate} onChangeText={setStartDate} placeholder="2026-08-01" />
          <Text style={styles.label}>End date (YYYY-MM-DD)</Text>
          <TextInput style={styles.input} value={endDate} onChangeText={setEndDate} placeholder="2026-08-03" />
          <Text style={styles.label}>Reason (optional)</Text>
          <TextInput style={styles.input} value={reason} onChangeText={setReason} multiline />
          <Button title={submitting ? 'Submitting…' : 'Submit request'} onPress={handleSubmit} disabled={submitting} />
          <Text style={styles.historyHeading}>My requests</Text>
        </View>
      }
      data={requests}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowType}>
              {item.leave_type} · {item.start_date} → {item.end_date}
            </Text>
            {item.reason ? <Text style={styles.rowReason}>{item.reason}</Text> : null}
          </View>
          <Text style={[styles.status, statusStyle(item.status)]}>{item.status}</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No leave requests yet.</Text>}
    />
  );
}

function statusStyle(status: string) {
  if (status === 'approved') return { color: '#0d9488' };
  if (status === 'rejected') return { color: '#ef4444' };
  return { color: '#f97316' };
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16 },
  form: { marginBottom: 16 },
  label: { fontSize: 12, color: '#666', marginBottom: 4, marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontSize: 12,
    overflow: 'hidden',
  },
  typeChipActive: { backgroundColor: '#0d9488', color: 'white', borderColor: '#0d9488' },
  historyHeading: { fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  rowType: { fontWeight: '600', textTransform: 'capitalize' },
  rowReason: { color: '#888', fontSize: 12, marginTop: 2 },
  status: { fontWeight: '700', textTransform: 'uppercase', fontSize: 12 },
  empty: { textAlign: 'center', color: '#888', marginTop: 20 },
});
