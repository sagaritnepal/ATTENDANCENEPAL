import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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
});
