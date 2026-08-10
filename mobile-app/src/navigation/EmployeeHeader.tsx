import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import CalendarSystemSwitch from '../components/CalendarSystemSwitch';

// Mirrors admin-web's EmployeeShell, which shows the same global AD/BS
// switch for employees as it does for admins — mobile's AdminHeader already
// had it, but nothing rendered it anywhere in the employee tab flow, so
// employees had no way to switch calendars at all despite every employee
// screen already reading useCalendarSystem() correctly.
export default function EmployeeHeader({ options }: any) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.title} numberOfLines={1}>
        {options.title}
      </Text>
      <View style={styles.bottomRow}>
        <CalendarSystemSwitch />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.slate200,
    paddingBottom: 10,
    paddingHorizontal: 12,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.ink },
  bottomRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
});
