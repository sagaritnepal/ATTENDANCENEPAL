import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Image, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import type { Branch, Employee } from '../types';
import { colors } from '../theme';

const EMPTY_FORM = { name: '', email: '', phone: '', address: '' };
const EMPTY_EMERGENCY = { emergency_contact_name: '', emergency_contact_relationship: '', emergency_contact_phone: '' };

function tenureDays(dateOfJoining: string | null, resignedAt: string | null) {
  if (!dateOfJoining) return null;
  const start = new Date(dateOfJoining).getTime();
  const end = resignedAt ? new Date(resignedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

export default function MyProfileScreen() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [emergency, setEmergency] = useState(EMPTY_EMERGENCY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillInput, setSkillInput] = useState('');

  function reload(empId: string) {
    supabase
      .from('employees')
      .select('*')
      .eq('id', empId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        const emp = { ...data, skills: data.skills ?? [] } as Employee;
        setEmployee(emp);
        setForm({ name: emp.name ?? '', email: emp.email ?? '', phone: emp.phone ?? '', address: emp.address ?? '' });
        setEmergency({
          emergency_contact_name: emp.emergency_contact_name ?? '',
          emergency_contact_relationship: emp.emergency_contact_relationship ?? '',
          emergency_contact_phone: emp.emergency_contact_phone ?? '',
        });
      });
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase.from('profiles').select('employee_id').eq('id', data.user.id).single();
      setLoading(false);
      if (profile?.employee_id) reload(profile.employee_id);
    });
    supabase.from('branches').select('*').then(({ data }) => setBranches((data as Branch[]) ?? []));
  }, []);

  async function saveProfile(overrides: { skills?: string[] } = {}) {
    const { error: rpcError } = await supabase.rpc('update_my_profile', {
      p_name: form.name,
      p_email: form.email || null,
      p_phone: form.phone || null,
      p_address: form.address || null,
      p_department: employee?.department ?? null,
      p_designation: employee?.designation ?? null,
      p_photo_url: employee?.profile_photo_url ?? null,
      p_skills: overrides.skills ?? employee?.skills ?? [],
      p_emergency_contact_name: emergency.emergency_contact_name || null,
      p_emergency_contact_relationship: emergency.emergency_contact_relationship || null,
      p_emergency_contact_phone: emergency.emergency_contact_phone || null,
    });
    return rpcError;
  }

  async function handleSave() {
    if (!employee) return;
    setSaving(true);
    setError(null);
    const rpcError = await saveProfile();
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setEditing(false);
    reload(employee.id);
  }

  async function addSkill() {
    const value = skillInput.trim();
    if (!value || !employee) return;
    const skill = value;
    if (employee.skills.includes(skill)) {
      setSkillInput('');
      return;
    }
    const rpcError = await saveProfile({ skills: [...employee.skills, skill] });
    if (rpcError) {
      Alert.alert('Could not add skill', rpcError.message);
      return;
    }
    setSkillInput('');
    reload(employee.id);
  }
  async function removeSkill(skill: string) {
    if (!employee) return;
    const rpcError = await saveProfile({ skills: employee.skills.filter(s => s !== skill) });
    if (rpcError) Alert.alert('Could not remove skill', rpcError.message);
    reload(employee.id);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }
  if (!employee) {
    return (
      <View style={styles.center}>
        <Text style={styles.warn}>Your account isn't linked to an employee record yet.</Text>
      </View>
    );
  }

  const days = tenureDays(employee.date_of_joining, employee.resigned_at);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          {employee.profile_photo_url ? <Image source={{ uri: employee.profile_photo_url }} style={styles.avatarImg} /> : <Text style={styles.avatarText}>{employee.name.slice(0, 1)}</Text>}
        </View>
        <Text style={styles.name}>{employee.name}</Text>
        <Text style={styles.designation}>{employee.designation ?? '—'}</Text>
        <Text style={styles.department}>{employee.department ?? '—'}</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>My Details</Text>
          {!editing && (
            <TouchableOpacity onPress={() => setEditing(true)}>
              <Text style={styles.editLink}>Edit</Text>
            </TouchableOpacity>
          )}
        </View>

        {!editing ? (
          <View>
            <DetailRow label="Name" value={employee.name} />
            <DetailRow label="Email" value={employee.email} />
            <DetailRow label="Phone" value={employee.phone} />
            <DetailRow label="Address" value={employee.address} />
            <Text style={styles.subheading}>Filled by employer</Text>
            <DetailRow label="Username" value={employee.username} />
            <DetailRow label="Enroll ID" value={employee.fingerprint_id} />
            <DetailRow label="Branch" value={branches.find(b => b.id === employee.branch_id)?.name} />
            <DetailRow label="Department" value={employee.department} />
            <DetailRow label="Designation" value={employee.designation} />
            <DetailRow label="Current Salary" value={employee.salary != null ? employee.salary.toLocaleString() : null} />
            <DetailRow label="PAN No." value={employee.pan_no} />
            <DetailRow label="SSF No." value={employee.ssf_no} />
            <DetailRow label="Date of joining" value={employee.date_of_joining} />
            <DetailRow label={employee.resigned_at ? 'Days worked' : 'Days with company'} value={days !== null ? `${days} days` : null} />
            <Text style={styles.subheading}>Emergency contact</Text>
            <DetailRow
              label="Contact"
              value={[employee.emergency_contact_name, employee.emergency_contact_relationship, employee.emergency_contact_phone].filter(Boolean).join(' — ') || null}
            />
          </View>
        ) : (
          <View>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} />
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))} />
            <Text style={styles.label}>Phone</Text>
            <TextInput style={styles.input} value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))} />
            <Text style={styles.label}>Address</Text>
            <TextInput style={[styles.input, { height: 60 }]} multiline value={form.address} onChangeText={v => setForm(f => ({ ...f, address: v }))} />
            <Text style={styles.subheading}>Emergency Contact</Text>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={emergency.emergency_contact_name} onChangeText={v => setEmergency(f => ({ ...f, emergency_contact_name: v }))} />
            <Text style={styles.label}>Relationship</Text>
            <TextInput style={styles.input} value={emergency.emergency_contact_relationship} onChangeText={v => setEmergency(f => ({ ...f, emergency_contact_relationship: v }))} />
            <Text style={styles.label}>Phone</Text>
            <TextInput style={styles.input} value={emergency.emergency_contact_phone} onChangeText={v => setEmergency(f => ({ ...f, emergency_contact_phone: v }))} />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditing(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Skills</Text>
        <View style={styles.chipsRow}>
          {employee.skills.map(skill => (
            <View key={skill} style={styles.skillChip}>
              <Text style={styles.skillChipText}>{skill}</Text>
              <TouchableOpacity onPress={() => removeSkill(skill)}>
                <Text style={styles.skillChipRemove}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
          {employee.skills.length === 0 && <Text style={styles.dim}>No skills added yet.</Text>}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="e.g. English, Forklift license…" placeholderTextColor={colors.slate400} value={skillInput} onChangeText={setSkillInput} />
          <TouchableOpacity style={styles.addSkillBtn} onPress={addSkill}>
            <Text style={styles.saveBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.slate50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.slate50 },
  warn: { color: colors.warningText, fontSize: 13, textAlign: 'center', padding: 24 },
  headerCard: { alignItems: 'center', backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 20, marginBottom: 16 },
  avatar: { height: 72, width: 72, borderRadius: 36, backgroundColor: colors.accentLight, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 10 },
  avatarImg: { height: '100%', width: '100%' },
  avatarText: { fontSize: 26, fontWeight: '700', color: colors.accent },
  name: { fontSize: 17, fontWeight: '700', color: colors.ink },
  designation: { fontSize: 13, color: colors.slate500, marginTop: 2 },
  department: { fontSize: 12, color: colors.slate400 },
  card: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.slate200, padding: 14, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  editLink: { fontSize: 12, fontWeight: '600', color: colors.accent },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  detailLabel: { fontSize: 12, color: colors.slate400 },
  detailValue: { fontSize: 12, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  subheading: { fontSize: 10, fontWeight: '700', color: colors.slate400, textTransform: 'uppercase', marginTop: 12, marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 8 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  saveBtn: { flex: 1, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  saveBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  skillChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.goodBg, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  skillChipText: { fontSize: 11, color: colors.goodText, fontWeight: '600' },
  skillChipRemove: { fontSize: 13, color: colors.goodText, fontWeight: '700' },
  dim: { fontSize: 12, color: colors.slate400 },
  addSkillBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  signOutBtn: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 24 },
  signOutText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
});
