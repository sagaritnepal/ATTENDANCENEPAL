import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Button } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog } from '../types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

export default function DashboardScreen({ navigation }: Props) {
  const [feed, setFeed] = useState<AttendanceLog[]>([]);

  useEffect(() => {
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
      <Button title="View Full Logs" onPress={() => navigation.navigate('History')} />
      <Text style={styles.heading}>Live Punch Feed</Text>
      <FlatList
        data={feed}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.type}>{item.punch_type === '0' ? 'IN' : 'OUT'}</Text>
            <Text style={{ flex: 1 }}>{new Date(item.punch_time).toLocaleTimeString()}</Text>
            <Text style={styles.method}>{item.method}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  heading: { fontSize: 18, fontWeight: '700', marginVertical: 12 },
  row: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' },
  type: { width: 48, fontWeight: '700' },
  method: { color: '#888' },
});
