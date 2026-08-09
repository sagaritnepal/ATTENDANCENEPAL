import React, { useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Image, Pressable, TextInput, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { colors } from '../theme';
import { BuildingIcon, CalendarDotIcon, EditIcon, KeyIcon, MailIcon, PinIcon, SignOutIcon } from './icons';

export default function AccountMenuModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { profile, session, refreshProfile } = useAuth();
  const [showEdit, setShowEdit] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const adminName = profile?.full_name || 'Admin';
  const roleLabel = profile?.role === 'admin' ? 'System Administrator' : profile?.role === 'hr' ? 'HR' : 'Employee';
  const initial = adminName.slice(0, 1).toUpperCase();

  async function handleSignOut() {
    onClose();
    await supabase.auth.signOut();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{adminName}</Text>
              <Text style={styles.role}>{roleLabel}</Text>
            </View>
            <View style={styles.avatarLg}>
              {profile?.photo_url ? (
                <Image source={{ uri: profile.photo_url }} style={styles.avatarImg} />
              ) : (
                <Text style={styles.avatarLgText}>{initial}</Text>
              )}
            </View>
          </View>

          <View style={styles.infoBlock}>
            <InfoRow icon={<MailIcon size={13} />} text={session?.user.email ?? '—'} bg={colors.infoBg} />
            <InfoRow icon={<BuildingIcon size={13} />} text={profile?.company_name || 'No company set'} bg="#f3e8ff" />
            <InfoRow icon={<PinIcon size={13} />} text={profile?.location || 'No address set'} bg={colors.warningBg} />
            <InfoRow
              icon={<CalendarDotIcon size={13} />}
              text={`Member since ${profile?.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`}
              bg={colors.goodBg}
            />
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowEdit(true)}>
              <EditIcon size={13} color={colors.white} />
              <Text style={styles.primaryBtnText}>Edit Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowPassword(true)}>
              <KeyIcon size={13} />
              <Text style={styles.secondaryBtnText}>Change Password</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
            <SignOutIcon size={13} />
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>

      {showEdit && <EditProfileModal onClose={() => setShowEdit(false)} onSaved={refreshProfile} />}
      {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
    </Modal>
  );
}

function InfoRow({ icon, text, bg }: { icon: React.ReactNode; text: string; bg: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: bg }]}>{icon}</View>
      <Text style={styles.infoText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function EditProfileModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [companyName, setCompanyName] = useState(profile?.company_name ?? '');
  const [location, setLocation] = useState(profile?.location ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() || null, company_name: companyName.trim() || null, location: location.trim() || null })
      .eq('id', profile.id);
    setSaving(false);
    if (error) {
      Alert.alert('Could not save', error.message);
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.formSheet} onPress={e => e.stopPropagation()}>
          <Text style={styles.formTitle}>Edit Profile</Text>
          <Text style={styles.formLabel}>Admin Name</Text>
          <TextInput style={styles.input} value={fullName} onChangeText={setFullName} />
          <Text style={styles.formLabel}>Company Name</Text>
          <TextInput style={styles.input} value={companyName} onChangeText={setCompanyName} />
          <Text style={styles.formLabel}>Location</Text>
          <TextInput style={styles.input} value={location} onChangeText={setLocation} />
          <View style={styles.formActions}>
            <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.saveBtn}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save changes'}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleChange() {
    setError(null);
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess(true);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.formSheet} onPress={e => e.stopPropagation()}>
          {success ? (
            <>
              <Text style={styles.formTitle}>Password changed</Text>
              <Text style={styles.formHint}>Your password has been updated. Use it next time you sign in.</Text>
              <View style={styles.formActions}>
                <TouchableOpacity onPress={onClose} style={[styles.saveBtn, { marginLeft: 'auto' }]}>
                  <Text style={styles.saveBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.formTitle}>Change Password</Text>
              <Text style={styles.formHint}>Sets a new password for your own login — you'll stay signed in.</Text>
              <Text style={styles.formLabel}>New password</Text>
              <TextInput style={styles.input} secureTextEntry value={newPassword} onChangeText={setNewPassword} />
              <Text style={styles.formLabel}>Confirm new password</Text>
              <TextInput style={styles.input} secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} />
              {error && <Text style={styles.errorText}>{error}</Text>}
              <View style={styles.formActions}>
                <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleChange} disabled={saving} style={styles.saveBtn}>
                  <Text style={styles.saveBtnText}>{saving ? 'Changing…' : 'Change password'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: colors.white, borderRadius: 16, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, backgroundColor: colors.accentLight },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  role: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  avatarLg: { height: 48, width: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { height: '100%', width: '100%' },
  avatarLgText: { color: colors.white, fontSize: 18, fontWeight: '700' },
  infoBlock: { padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: colors.slate200 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoIcon: { height: 24, width: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  infoText: { flex: 1, fontSize: 12, color: colors.slate500 },
  actionsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.slate200 },
  primaryBtn: { flex: 1, flexDirection: 'row', gap: 6, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  secondaryBtn: { flex: 1, flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: colors.slate500, fontSize: 12, fontWeight: '700' },
  signOutBtn: { flexDirection: 'row', gap: 6, backgroundColor: colors.criticalBg, borderRadius: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', margin: 12, marginTop: 8 },
  signOutText: { color: colors.criticalText, fontSize: 12, fontWeight: '700' },
  formSheet: { backgroundColor: colors.white, borderRadius: 16, padding: 20 },
  formTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  formHint: { fontSize: 12, color: colors.slate500, marginBottom: 12 },
  formLabel: { fontSize: 12, fontWeight: '600', color: colors.slate500, marginBottom: 4, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.slate200, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colors.ink },
  errorText: { color: colors.criticalText, fontSize: 12, marginTop: 8 },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.slate500 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  saveBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
