import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import type { LeaderboardRow } from '../types';
import { colors } from '../theme';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Leaderboard({ highlightEmployeeId }: { highlightEmployeeId?: string }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.rpc('get_leaderboard').then(({ data }) => {
      setRows((data as LeaderboardRow[]) ?? []);
      setLoading(false);
    });
  }, []);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Leaderboard</Text>
      {loading ? (
        <ActivityIndicator color={colors.accent} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>No points earned yet.</Text>
      ) : (
        rows.map((row, i) => {
          const isSelf = row.employee_id === highlightEmployeeId;
          return (
            <View key={row.employee_id} style={[styles.row, isSelf && styles.rowSelf]}>
              <Text style={styles.rank}>{MEDALS[i] ?? String(i + 1)}</Text>
              <View style={styles.avatar}>
                {row.profile_photo_url ? <Image source={{ uri: row.profile_photo_url }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{row.name.slice(0, 1)}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, isSelf && { color: colors.accent }]}>
                  {row.name}
                  {isSelf ? ' (you)' : ''}
                </Text>
                <Text style={styles.meta}>
                  {row.department ?? '—'} · {row.tasks_completed} task{row.tasks_completed === 1 ? '' : 's'} done
                </Text>
              </View>
              <Text style={styles.points}>{row.total_points} pts</Text>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14 },
  title: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  empty: { fontSize: 12, color: colors.slate400 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.slate100 },
  rowSelf: { backgroundColor: colors.accentLight, borderRadius: 8, paddingHorizontal: 6 },
  rank: { width: 22, textAlign: 'center', fontSize: 13, fontWeight: '700', color: colors.slate400 },
  avatar: { height: 30, width: 30, borderRadius: 15, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { height: '100%', width: '100%' },
  avatarText: { fontSize: 12, fontWeight: '700', color: colors.accent },
  name: { fontSize: 13, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 10, color: colors.slate400, marginTop: 1 },
  points: { fontSize: 13, fontWeight: '700', color: colors.ink },
});
