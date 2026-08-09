import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, Image, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    setError(null);
    setSubmitting(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (authError) setError(authError.message);
  }

  return (
    <KeyboardAvoidingView style={styles.outer} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title}>Attendance Nepal</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@company.com"
          placeholderTextColor={colors.slate400}
          value={email}
          onChangeText={setEmail}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={colors.slate400}
          value={password}
          onChangeText={setPassword}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={handleLogin} disabled={submitting}>
          <Text style={styles.buttonText}>{submitting ? 'Signing in…' : 'Sign in'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: colors.slate50, justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: colors.slate200,
    alignItems: 'center',
  },
  logo: { height: 96, width: 96, marginBottom: 10 },
  title: { fontSize: 19, fontWeight: '700', color: colors.ink, marginBottom: 24 },
  label: { alignSelf: 'flex-start', fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 6 },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 16,
    fontSize: 14,
    color: colors.ink,
  },
  error: { color: colors.criticalText, fontSize: 13, marginBottom: 12, alignSelf: 'flex-start' },
  button: { width: '100%', backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
