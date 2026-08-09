import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useCalendarSystem } from '../lib/CalendarSystemContext';
import { colors } from '../theme';

export default function CalendarSystemSwitch() {
  const { system, setSystem } = useCalendarSystem();
  return (
    <View style={styles.container}>
      <TouchableOpacity style={[styles.btn, styles.btnLeft, system === 'AD' && styles.btnActive]} onPress={() => setSystem('AD')}>
        <Text style={[styles.text, system === 'AD' && styles.textActive]}>AD</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.btnRight, system === 'BS' && styles.btnActive]} onPress={() => setSystem('BS')}>
        <Text style={[styles.text, system === 'BS' && styles.textActive]}>BS</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', borderWidth: 1, borderColor: colors.slate200, borderRadius: 8, overflow: 'hidden' },
  btn: { paddingHorizontal: 8, paddingVertical: 5, backgroundColor: colors.white },
  btnLeft: {},
  btnRight: { borderLeftWidth: 1, borderLeftColor: colors.slate200 },
  btnActive: { backgroundColor: colors.accent },
  text: { fontSize: 11, fontWeight: '700', color: colors.slate500 },
  textActive: { color: colors.white },
});
