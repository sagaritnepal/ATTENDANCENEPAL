import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as LocalAuthentication from 'expo-local-authentication';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './src/lib/supabase';
import type { Profile } from './src/types';
import LoginScreen from './src/screens/LoginScreen';
import CheckInScreen from './src/screens/CheckInScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import LeaveRequestScreen from './src/screens/LeaveRequestScreen';

export type RootStackParamList = {
  Login: undefined;
  CheckIn: undefined;
  History: undefined;
  Dashboard: undefined;
  Leave: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Only ever true on a device that actually has biometrics set up — a
  // phone with no fingerprint/face enrolled never locks at all instead of
  // blocking access with a feature it can't satisfy.
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [locked, setLocked] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  const authenticate = useCallback(async () => {
    setAuthenticating(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Attendance Nepal' });
      if (result.success) setLocked(false);
    } finally {
      setAuthenticating(false);
    }
  }, []);

  // Locks immediately once a session exists on a biometric-capable device —
  // re-checked per session rather than once at app start, since logging out
  // and a different person logging in on the same phone should re-lock too.
  useEffect(() => {
    if (!session) {
      setLocked(false);
      setBiometricAvailable(false);
      return;
    }
    let active = true;
    (async () => {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!active) return;
      const available = hasHardware && isEnrolled;
      setBiometricAvailable(available);
      if (available) {
        setLocked(true);
        authenticate();
      }
    })();
    return () => {
      active = false;
    };
  }, [session, authenticate]);

  // Re-lock only on a real background->active transition, not the
  // momentary 'inactive' state the biometric prompt itself causes — a
  // naive "lock on every active event" would immediately re-lock right
  // after a successful unlock.
  useEffect(() => {
    if (!biometricAvailable) return;
    let prevState = AppState.currentState;
    const sub = AppState.addEventListener('change', nextState => {
      if (prevState === 'background' && nextState === 'active') {
        setLocked(true);
        authenticate();
      }
      prevState = nextState;
    });
    return () => sub.remove();
  }, [biometricAvailable, authenticate]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => setProfile(data as Profile));
  }, [session]);

  if (loading) {
    return (
      <View style={styles.webOuter}>
        <View style={[styles.webInner, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator size="large" />
        </View>
      </View>
    );
  }

  if (locked) {
    return (
      <View style={styles.webOuter}>
        <View style={[styles.webInner, styles.lockScreen]}>
          <View style={styles.lockIcon}>
            <Text style={styles.lockIconGlyph}>🔒</Text>
          </View>
          <Text style={styles.lockTitle}>Locked</Text>
          <Text style={styles.lockSubtitle}>Unlock with your fingerprint or face to continue.</Text>
          <TouchableOpacity onPress={authenticate} disabled={authenticating} style={styles.unlockButton}>
            <Text style={styles.unlockButtonText}>{authenticating ? 'Verifying…' : 'Unlock'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.webOuter}>
      <View style={styles.webInner}>
        <NavigationContainer>
          <Stack.Navigator>
            {!session ? (
              <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'Sign in' }} />
            ) : profile?.role === 'admin' ? (
              <>
                <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Live Dashboard' }} />
                <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'Attendance Logs' }} />
              </>
            ) : (
              <>
                <Stack.Screen name="CheckIn" component={CheckInScreen} options={{ title: 'Check In / Out' }} />
                <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'My Attendance' }} />
                <Stack.Screen name="Leave" component={LeaveRequestScreen} options={{ title: 'Leave Requests' }} />
              </>
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </View>
    </View>
  );
}

// On an actual phone this is a no-op (the card already fills the viewport).
// On a desktop browser it keeps the app from stretching edge-to-edge into an
// unusably wide layout, centering it as a phone-width card instead.
const styles = StyleSheet.create({
  webOuter: (Platform.OS === 'web'
    ? { flex: 1, alignItems: 'center', backgroundColor: '#e2e8f0', minHeight: '100vh' }
    : { flex: 1 }) as object,
  webInner: (Platform.OS === 'web'
    ? { flex: 1, width: '100%', maxWidth: 480, backgroundColor: '#fff', boxShadow: '0 0 24px rgba(0,0,0,0.08)' }
    : { flex: 1 }) as object,
  lockScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#023c69',
    paddingHorizontal: 32,
  },
  lockIcon: {
    height: 72,
    width: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  lockIconGlyph: { fontSize: 32 },
  lockTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 6 },
  lockSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 24 },
  unlockButton: { backgroundColor: '#0d9488', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 10 },
  unlockButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
