import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../theme';

export default function StatCard({
  label,
  value,
  hint,
  onPress,
}: {
  label: string;
  value: string;
  hint?: string;
  onPress?: () => void;
}) {
  const Wrapper: React.ElementType = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.card} onPress={onPress} activeOpacity={onPress ? 0.7 : undefined}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
      {hint ? (
        <View style={styles.hintRow}>
          <View style={styles.dot} />
          <Text style={styles.hint} numberOfLines={1}>
            {hint}
          </Text>
        </View>
      ) : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '48%',
    backgroundColor: colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.slate200,
    padding: 14,
    marginBottom: 10,
  },
  label: { fontSize: 12, color: colors.slate500 },
  value: { fontSize: 24, fontWeight: '700', color: colors.ink, marginTop: 8 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  dot: { height: 4, width: 4, borderRadius: 2, backgroundColor: colors.accent },
  hint: { fontSize: 11, color: colors.slate500, flexShrink: 1 },
});
