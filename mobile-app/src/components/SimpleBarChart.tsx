import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

export default function SimpleBarChart({ data, unit = 'hrs' }: { data: { label: string; value: number }[]; unit?: string }) {
  const maxVal = Math.max(1, ...data.map(d => d.value));
  return (
    <View style={{ gap: 8 }}>
      {data.map(d => (
        <View key={d.label} style={styles.row}>
          <Text style={styles.label} numberOfLines={1}>
            {d.label}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(4, (d.value / maxVal) * 100)}%` }]} />
          </View>
          <Text style={styles.value}>
            {d.value} {unit}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { width: 80, fontSize: 11, color: colors.slate500 },
  track: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.slate100 },
  fill: { height: 10, borderRadius: 5, backgroundColor: colors.accent },
  value: { width: 56, fontSize: 10, color: colors.ink, fontWeight: '600', textAlign: 'right' },
});
