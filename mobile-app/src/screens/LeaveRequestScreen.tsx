import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import type { LeaveRequest, LeaveType } from '../types';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { formatAdDate } from '../lib/calendar';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import DatePicker from '../components/DatePicker';

const LEAVE_TYPES: LeaveType[] = ['casual', 'sick', 'annual', 'unpaid'];

function statusTone(status: string) {
  if (status === 'approved') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  return 'warning' as const;
}

export default function LeaveRequestScreen() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveType, setLeaveType] = useState<LeaveType>('casual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      if (profile?.employee_id) {
        setEmployeeId(profile.employee_id);
        reload(profile.employee_id);
      } else {
        setLoading(false);
      }
    });
  }, []);

  async function handleSubmit() {
    setError(null);
    if (!employeeId) {
      setError('Your account isn’t linked to an employee record yet.');
      return;
    }
    if (!startDate || !endDate) {
      setError('Pick both a start date and an end date.');
      return;
    }
    setSubmitting(true);
    const { error: insertError } = await supabase.from('leave_requests').insert({
      employee_id: employeeId,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      reason: reason || null,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setStartDate('');
    setEndDate('');
    setReason('');
    reload(employeeId);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.form}>
          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {LEAVE_TYPES.map(t => (
              <TouchableOpacity key={t} style={[styles.typeChip, leaveType === t && styles.typeChipActive]} onPress={() => setLeaveType(t)}>
                <Text style={[styles.typeChipText, leaveType === t && styles.typeChipTextActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Start date</Text>
          <DatePicker value={startDate} onChange={setStartDate} />
          <Text style={styles.label}>End date</Text>
          <DatePicker value={endDate} onChange={setEndDate} />
          <Text style={styles.label}>Reason (optional)</Text>
          <TextInput style={[styles.input, { height: 60 }]} value={reason} onChangeText={setReason} multiline placeholderTextColor={colors.slate400} />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
            <Text style={styles.submitBtnText}>{submitting ? 'Submitting…' : 'Submit request'}</Text>
          </TouchableOpacity>
          <Text style={styles.historyHeading}>My requests</Text>
        </View>
      }
      data={requests}
      keyExtractor={item => item.id}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowType}>
              {item.leave_type} · {formatAdDate(item.start_date, system)} → {formatAdDate(item.end_date, system)}
            </Text>
            {item.reason ? <Text style={styles.rowReason}>{item.reason}</Text> : null}
          </View>
          <Badge tone={statusTone(item.status)}>{item.status}</Badge>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No leave requests yet.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  list: { padding: 16 },
  form: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 10 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, padding: 10, fontSize: 14, color: colors.ink },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  typeChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  typeChipText: { fontSize: 12, color: colors.slate500, textTransform: 'capitalize' },
  typeChipTextActive: { color: colors.white, fontWeight: '600' },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 10 },
  submitBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 14 },
  submitBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  historyHeading: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  rowType: { fontWeight: '600', color: colors.ink, textTransform: 'capitalize', fontSize: 13 },
  rowReason: { color: colors.slate400, fontSize: 12, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.slate400, marginTop: 20 },
});
