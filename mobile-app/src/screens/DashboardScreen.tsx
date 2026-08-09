import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog, Employee } from '../types';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { AdminTabParamList } from '../../App';
import { colors } from '../theme';

type Props = BottomTabScreenProps<AdminTabParamList, 'Dashboard'>;

type EmployeeLite = Pick<Employee, 'name' | 'profile_photo_url'>;

export default function DashboardScreen({ navigation }: Props) {
  const [feed, setFeed] = useState<AttendanceLog[]>([]);
  const [employees, setEmployees] = useState<Record<string, EmployeeLite>>({});

  useEffect(() => {
    supabase
      .from('employees')
      .select('id, name, profile_photo_url')
      .then(({ data }) => {
        const map: Record<string, EmployeeLite> = {};
        for (const e of data ?? []) map[e.id] = { name: e.name, profile_photo_url: e.profile_photo_url };
        setEmployees(map);
      });

    supabase
      .from('attendance_logs')
      .select('*')
      .order('punch_time', { ascending: false })
      .limit(20)
      .then(({ data }) => setFeed((data as AttendanceLog[]) ?? []));

    // Live feed: admins see every new punch the instant it lands, across all
    // check-in methods and branches, without polling.
    const channel = supabase
      .channel('attendance-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'attendance_logs' },
        payload => setFeed(prev => [payload.new as AttendanceLog, ...prev].slice(0, 20))
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.viewLogsButton} onPress={() => navigation.navigate('Attendance')}>
        <Text style={styles.viewLogsText}>View Full Logs</Text>
      </TouchableOpacity>
      <Text style={styles.heading}>Live Punch Feed</Text>
      <FlatList
        data={feed}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const emp = employees[item.employee_id];
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
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  viewLogsButton: { backgroundColor: '#0d9488', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  viewLogsText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  heading: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 10 },
  list: { paddingBottom: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  avatarImage: { height: 36, width: 36, borderRadius: 18, backgroundColor: '#e2e8f0' },
  avatar: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: '#0d948820',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#0d9488', fontWeight: '700', fontSize: 14 },
  name: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  time: { fontSize: 12, color: '#64748b', marginTop: 1 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  typeInBg: { backgroundColor: '#dcfce7' },
  typeOutBg: { backgroundColor: '#fee2e2' },
  typeInText: { fontSize: 11, fontWeight: '700', color: '#166534' },
  typeOutText: { fontSize: 11, fontWeight: '700', color: '#991b1b' },
  empty: { textAlign: 'center', marginTop: 40, color: '#94a3b8' },
});
