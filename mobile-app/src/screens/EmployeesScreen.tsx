import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity, Modal, Alert, Image } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Employee, Profile, Shift } from '../types';
import { resolveShift, formatShiftHours } from '../lib/shift';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { ChevronIcon, KeyIcon, ResignedIcon as UserMinusIcon } from '../components/icons';

export default function EmployeesScreen({ route }: any) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterEmployeeIds, setRosterEmployeeIds] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'employee_id' | 'role'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(route?.params?.filter ?? 'All');
  const [filterOpen, setFilterOpen] = useState(false);

  function reload() {
    supabase
      .from('employees')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setEmployees((data as Employee[]) ?? []);
        setLoading(false);
      });
    supabase.from('shifts').select('*').then(({ data }) => setShifts((data as Shift[]) ?? []));
    supabase
      .from('employee_daily_shifts')
      .select('employee_id')
      .then(({ data }) => setRosterEmployeeIds(new Set((data ?? []).map((r: any) => r.employee_id))));
    supabase
      .from('profiles')
      .select('id, employee_id, role')
      .then(({ data }) => setProfiles((data as any) ?? []));
  }

  useEffect(reload, []);

  useEffect(() => {
    if (route?.params?.filter) setFilter(route.params.filter);
  }, [route?.params?.filter]);

  const linkedEmployeeIds = useMemo(
    () => new Set(profiles.map(p => p.employee_id).filter((id): id is string => Boolean(id))),
    [profiles]
  );

  const departments = useMemo(
    () => Array.from(new Set(employees.map(e => e.department).filter(Boolean))) as string[],
    [employees]
  );
  const filterOptions = ['All', ...departments, 'Unenrolled', 'Resigned'];

  const filtered = useMemo(() => {
    let list = employees;
    if (filter === 'Resigned') {
      list = list.filter(e => e.status !== 'active');
    } else {
      list = list.filter(e => e.status === 'active');
      if (filter === 'Unenrolled') list = list.filter(e => !e.fingerprint_id);
      else if (filter !== 'All') list = list.filter(e => e.department === filter);
    }
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(e =>
        [e.name, e.employee_code, e.phone, e.email, e.department, e.designation, e.fingerprint_id]
          .filter(Boolean)
          .some(v => (v as string).toLowerCase().includes(term))
      );
    }
    return [...list].sort((a, b) => (b as any).created_at?.localeCompare((a as any).created_at ?? '') ?? 0);
  }, [employees, filter, search]);

  async function handleMarkResigned(emp: Employee) {
    Alert.alert('Mark Resigned', `Mark ${emp.name} as resigned? They'll be removed from active views but their history is kept.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark Resigned',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase
            .from('employees')
            .update({ status: 'inactive', resigned_at: new Date().toISOString().slice(0, 10) })
            .eq('id', emp.id);
          if (error) Alert.alert('Could not update', error.message);
          reload();
        },
      },
    ]);
  }

  async function handleRestore(emp: Employee) {
    Alert.alert('Restore', `Restore ${emp.name} to active? They'll show up in active views again.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        onPress: async () => {
          const { error } = await supabase.from('employees').update({ status: 'active', resigned_at: null }).eq('id', emp.id);
          if (error) Alert.alert('Could not update', error.message);
          reload();
        },
      },
    ]);
  }

  async function handleRemove(emp: Employee) {
    Alert.alert('Remove employee', `Remove ${emp.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('employees').delete().eq('id', emp.id);
          if (error) {
            Alert.alert(
              'Could not remove',
              error.code === '23503'
                ? 'This employee already has attendance, tasks, or other records tied to them. Use "Mark Resigned" instead.'
                : error.message
            );
            return;
          }
          reload();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setFilterOpen(true)}>
          <Text style={styles.filterBtnText} numberOfLines={1}>
            {filter === 'All' ? 'All Departments' : filter === 'Unenrolled' ? 'Biometric Unenrolled' : filter === 'Resigned' ? 'Resigned Employees' : filter}
          </Text>
          <ChevronIcon size={14} />
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.search}
        placeholder="Search employees…"
        placeholderTextColor={colors.slate400}
        value={search}
        onChangeText={setSearch}
      />
      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const shift = resolveShift(item, shifts);
          const registered = Boolean(item.branch_id) && (rosterEmployeeIds.has(item.id) || shift.id !== 'default');
          const hasLogin = linkedEmployeeIds.has(item.id);
          return (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.avatar}>
                  {item.profile_photo_url ? (
                    <Image source={{ uri: item.profile_photo_url }} style={styles.avatarImg} />
                  ) : (
                    <Text style={styles.avatarText}>{item.name.slice(0, 1).toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.meta}>{item.phone ?? '—'}</Text>
                  {item.email ? <Text style={styles.meta}>{item.email}</Text> : null}
                  <Text style={styles.meta}>
                    {[item.designation, item.department].filter(Boolean).join(' · ') || '—'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Badge tone={registered ? 'good' : 'warning'}>{registered ? 'Registered' : 'Unregistered'}</Badge>
                  {hasLogin && <Badge tone="good">Login Active</Badge>}
                </View>
              </View>

              <View style={styles.infoGrid}>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>ID</Text>
                  <Text style={styles.infoValue}>{item.fingerprint_id ?? '—'}</Text>
                </View>
                <View style={styles.infoCell}>
                  <Text style={styles.infoLabel}>Shift</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>
                    {rosterEmployeeIds.has(item.id) ? 'Custom Roster' : shift.name}
                  </Text>
                  {!rosterEmployeeIds.has(item.id) && <Text style={styles.infoSub}>{formatShiftHours(shift)}</Text>}
                </View>
              </View>

              <View style={styles.actionsRow}>
                {item.status === 'active' ? (
                  <TouchableOpacity style={[styles.actionTile, styles.actionWarning]} onPress={() => handleMarkResigned(item)}>
                    <UserMinusIcon size={14} color={colors.warningText} />
                    <Text style={[styles.actionText, { color: colors.warningText }]}>Mark Resigned</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.actionTile, styles.actionAccent]} onPress={() => handleRestore(item)}>
                    <KeyIcon size={14} color={colors.accent} />
                    <Text style={[styles.actionText, { color: colors.accent }]}>Restore</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.actionTile, styles.actionCritical]} onPress={() => handleRemove(item)}>
                  <Text style={[styles.actionText, { color: colors.criticalText }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>No employees match this filter.</Text>}
      />

      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setFilterOpen(false)}>
          <View style={styles.modalSheet}>
            {filterOptions.map(f => (
              <TouchableOpacity
                key={f}
                style={styles.modalOption}
                onPress={() => {
                  setFilter(f);
                  setFilterOpen(false);
                }}
              >
                <Text style={[styles.modalOptionText, filter === f && { color: colors.accent, fontWeight: '700' }]}>
                  {f === 'All' ? 'All Departments' : f === 'Unenrolled' ? 'Biometric Unenrolled' : f === 'Resigned' ? 'Resigned Employees' : f}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  filterRow: { paddingHorizontal: 16, paddingTop: 16 },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.white,
  },
  filterBtnText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  search: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.white,
    color: colors.ink,
  },
  list: { padding: 16, paddingTop: 8 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar: {
    height: 40,
    width: 40,
    borderRadius: 20,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { height: '100%', width: '100%' },
  avatarText: { color: colors.accent, fontWeight: '700', fontSize: 16 },
  name: { fontSize: 15, fontWeight: '600', color: colors.ink },
  meta: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  infoGrid: { flexDirection: 'row', gap: 16, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.slate200 },
  infoCell: { flex: 1 },
  infoLabel: { fontSize: 10, color: colors.slate400, textTransform: 'uppercase' },
  infoValue: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 2 },
  infoSub: { fontSize: 10, color: colors.slate400 },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionTile: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingVertical: 8, borderWidth: 1 },
  actionAccent: { backgroundColor: colors.accentLight, borderColor: colors.accent },
  actionWarning: { backgroundColor: colors.warningBg, borderColor: colors.warning },
  actionCritical: { backgroundColor: colors.criticalBg, borderColor: colors.critical },
  actionText: { fontSize: 11, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 40, color: colors.slate400 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, maxHeight: '60%' },
  modalOption: { paddingHorizontal: 20, paddingVertical: 14 },
  modalOptionText: { fontSize: 14, color: colors.ink },
});
