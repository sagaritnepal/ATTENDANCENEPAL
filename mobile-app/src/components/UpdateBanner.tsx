import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { colors } from '../theme';

export default function UpdateBanner({ downloadUrl }: { downloadUrl: string }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>A new version is available.</Text>
      <TouchableOpacity onPress={() => Linking.openURL(downloadUrl)}>
        <Text style={styles.link}>Download</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setDismissed(true)} style={styles.dismissBtn}>
        <Text style={styles.dismiss}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.accent,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 10,
  },
  text: { flex: 1, color: colors.white, fontSize: 12, fontWeight: '600' },
  link: { color: colors.white, fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' },
  dismissBtn: { paddingLeft: 10 },
  dismiss: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
});
