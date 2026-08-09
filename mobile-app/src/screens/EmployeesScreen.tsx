import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet, ActivityIndicator, TextInput, TouchableOpacity, Modal, Alert, Image } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Branch, Department, Employee, Profile, Shift } from '../types';
import { resolveShift, formatShiftHours } from '../lib/shift';
import { colors } from '../theme';
import Badge from '../components/Badge';
import { ChevronIcon, KeyIcon, ResignedIcon as UserMinusIcon } from '../components/icons';

const EMPTY_ADD_FORM = { employee_code: '', name: '', phone: '', email: '', address: '', designation: '', fingerprint_id: '', date_of_joining: '' };

export default function EmployeesScreen({ route, navigation }: any) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rosterEmployeeIds, setRosterEmployeeIds] = useState<Set<string>>(new Set());
  const [profiles, setProfiles] = useState<Pick<Profile, 'id' | 'employee_id' | 'role'>[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(route?.params?.filter ?? 'All');
  const [filterOpen, setFilterOpen] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addDepartment, setAddDepartment] = useState<string | null>(null);
  const [addBranchId, setAddBranchId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
    supabase.from('branches').select('*').order('name').then(({ data }) => setBranches((data as Branch[]) ?? []));
    supabase.from('departments').select('*').order('name').then(({ data }) => setDepartmentOptions((data as Department[]) ?? []));
  }

  async function handleAddEmployee() {
    if (!addForm.employee_code.trim() || !addForm.name.trim()) {
      setAddError('Employee code and name are required.');
      return;
    }
    setSaving(true);
    setAddError(null);
    const { error } = await supabase.from('employees').insert({
      employee_code: addForm.employee_code,
      name: addForm.name,
      phone: addForm.phone || null,
      email: addForm.email || null,
      address: addForm.address || null,
      department: addDepartment,
      designation: addForm.designation || null,
      fingerprint_id: addForm.fingerprint_id || null,
      branch_id: addBranchId,
      date_of_joining: addForm.date_of_joining || null,
      status: 'active',
    });
    setSaving(false);
    if (error) {
      setAddError(error.code === '23505' ? 'That Employee ID is already in use.' : error.message);
      return;
    }
    setAddForm(EMPTY_ADD_FORM);
    setAddDepartment(null);
    setAddBranchId(null);
    setShowAddForm(false);
    reload();
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
        <TouchableOpacity style={[styles.filterBtn, { flex: 1 }]} onPress={() => setFilterOpen(true)}>
          <Text style={styles.filterBtnText} numberOfLines={1}>
            {filter === 'All' ? 'All Departments' : filter === 'Unenrolled' ? 'Biometric Unenrolled' : filter === 'Resigned' ? 'Resigned Employees' : filter}
          </Text>
          <ChevronIcon size={14} />
        </TouchableOpacity>
        {filter !== 'Resigned' && (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        )}
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
              <TouchableOpacity style={styles.cardHeader} onPress={() => navigation.navigate('EmployeeDetail', { employeeId: item.id })}>
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
              </TouchableOpacity>

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

      <Modal visible={showAddForm} transparent animationType="fade" onRequestClose={() => setShowAddForm(false)}>
        <TouchableOpacity style={styles.modalBackdropCenter} activeOpacity={1} onPress={() => setShowAddForm(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.formSheet}>
            <ScrollView>
              <View>
                  <Text style={styles.formTitle}>Add Employee</Text>
                  <Text style={styles.label}>Employee code</Text>
                  <TextInput style={styles.input} value={addForm.employee_code} onChangeText={v => setAddForm(f => ({ ...f, employee_code: v }))} />
                  <Text style={styles.label}>Full name</Text>
                  <TextInput style={styles.input} value={addForm.name} onChangeText={v => setAddForm(f => ({ ...f, name: v }))} />
                  <Text style={styles.label}>Phone</Text>
                  <TextInput style={styles.input} value={addForm.phone} onChangeText={v => setAddForm(f => ({ ...f, phone: v }))} keyboardType="phone-pad" />
                  <Text style={styles.label}>Email</Text>
                  <TextInput style={styles.input} value={addForm.email} onChangeText={v => setAddForm(f => ({ ...f, email: v }))} keyboardType="email-address" />
                  <Text style={styles.label}>Address</Text>
                  <TextInput style={styles.input} value={addForm.address} onChangeText={v => setAddForm(f => ({ ...f, address: v }))} />
                  <Text style={styles.label}>Designation</Text>
                  <TextInput style={styles.input} value={addForm.designation} onChangeText={v => setAddForm(f => ({ ...f, designation: v }))} />
                  <Text style={styles.label}>Fingerprint / Biometric ID</Text>
                  <TextInput style={styles.input} value={addForm.fingerprint_id} onChangeText={v => setAddForm(f => ({ ...f, fingerprint_id: v }))} />
                  <Text style={styles.label}>Date of joining (YYYY-MM-DD)</Text>
                  <TextInput style={styles.input} value={addForm.date_of_joining} onChangeText={v => setAddForm(f => ({ ...f, date_of_joining: v }))} placeholder="2026-01-15" placeholderTextColor={colors.slate400} />

                  <Text style={styles.label}>Department</Text>
                  <View style={styles.chipsRow}>
                    <TouchableOpacity style={[styles.pickChip, addDepartment === null && styles.pickChipActive]} onPress={() => setAddDepartment(null)}>
                      <Text style={[styles.pickChipText, addDepartment === null && styles.pickChipTextActive]}>Unassigned</Text>
                    </TouchableOpacity>
                    {departmentOptions.map(d => (
                      <TouchableOpacity key={d.id} style={[styles.pickChip, addDepartment === d.name && styles.pickChipActive]} onPress={() => setAddDepartment(d.name)}>
                        <Text style={[styles.pickChipText, addDepartment === d.name && styles.pickChipTextActive]}>{d.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.label}>Branch</Text>
                  <View style={styles.chipsRow}>
                    <TouchableOpacity style={[styles.pickChip, addBranchId === null && styles.pickChipActive]} onPress={() => setAddBranchId(null)}>
                      <Text style={[styles.pickChipText, addBranchId === null && styles.pickChipTextActive]}>Unassigned</Text>
                    </TouchableOpacity>
                    {branches.map(b => (
                      <TouchableOpacity key={b.id} style={[styles.pickChip, addBranchId === b.id && styles.pickChipActive]} onPress={() => setAddBranchId(b.id)}>
                        <Text style={[styles.pickChipText, addBranchId === b.id && styles.pickChipTextActive]}>{b.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {!addBranchId && <Text style={styles.hint}>GPS check-in won't work until set.</Text>}

                  {addError && <Text style={styles.errorText}>{addError}</Text>}
                  <View style={styles.formActions}>
                    <TouchableOpacity onPress={() => setShowAddForm(false)} style={styles.cancelBtn}>
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleAddEmployee} disabled={saving} style={styles.saveModalBtn}>
                      <Text style={styles.saveModalBtnText}>{saving ? 'Saving…' : 'Save employee'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 16 },
  addBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  addBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
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
  modalBackdropCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  formSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20, maxHeight: '85%' },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink },
  hint: { fontSize: 11, color: colors.slate400, marginTop: 4 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pickChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.slate200, backgroundColor: colors.white },
  pickChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pickChipText: { fontSize: 11, fontWeight: '600', color: colors.slate500 },
  pickChipTextActive: { color: colors.white },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 8 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  saveModalBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  saveModalBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
