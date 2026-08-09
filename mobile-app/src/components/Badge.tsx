import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme';

const TONES = {
  good: { bg: colors.goodBg, text: colors.goodText },
  warning: { bg: colors.warningBg, text: colors.warningText },
  critical: { bg: colors.criticalBg, text: colors.criticalText },
  info: { bg: colors.infoBg, text: colors.infoText },
  neutral: { bg: colors.slate200, text: colors.slate500 },
} as const;

export default function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      <Text style={[styles.text, { color: t.text }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  text: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
});
