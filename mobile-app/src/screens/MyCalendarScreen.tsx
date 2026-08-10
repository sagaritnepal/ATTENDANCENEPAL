import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
import EmployeeCalendarView from '../components/EmployeeCalendarView';

export default function MyCalendarScreen() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) {
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setLoading(false);
      setEmployeeId(profile?.employee_id ?? null);
    });
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!employeeId) {
    return (
      <View style={styles.center}>
        <Text style={styles.warn}>Your account isn't linked to an employee record yet.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <EmployeeCalendarView employeeId={employeeId} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
});
