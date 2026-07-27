import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import type { AttendanceLog } from '../types';

export default function HistoryScreen() {
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('attendance_logs')
      .select('*')
      .order('punch_time', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setLogs((data as AttendanceLog[]) ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <FlatList
      data={logs}
      keyExtractor={item => item.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Text style={styles.type}>{item.punch_type === '0' ? 'IN' : 'OUT'}</Text>
          <View style={{ flex: 1 }}>
            <Text>{new Date(item.punch_time).toLocaleString()}</Text>
            <Text style={styles.method}>{item.method}</Text>
          </View>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No attendance records yet.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  type: { width: 48, fontWeight: '700' },
  method: { color: '#888', fontSize: 12 },
  empty: { textAlign: 'center', marginTop: 40, color: '#888' },
});
