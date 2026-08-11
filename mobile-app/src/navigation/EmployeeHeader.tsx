import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useAuth } from '../lib/AuthContext';
import CalendarSystemSwitch from '../components/CalendarSystemSwitch';
import AccountMenuModal from '../components/AccountMenuModal';

export default function EmployeeHeader({ options }: any) {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);

  const name = profile?.full_name || 'Employee';
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topRow}>
        <Text style={styles.title} numberOfLines={1}>
          {options.title}
        </Text>

        <TouchableOpacity style={styles.identity} onPress={() => setMenuOpen(true)}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.avatar}>
            {profile?.photo_url ? (
              <Image source={{ uri: profile.photo_url }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarText}>{initial}</Text>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <View style={styles.bottomRow}>
        <CalendarSystemSwitch />
      </View>

      <AccountMenuModal visible={menuOpen} onClose={() => setMenuOpen(false)} />
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
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '55%' },
  name: { fontSize: 13, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  avatar: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { height: '100%', width: '100%' },
  avatarText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
});
