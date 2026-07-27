import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
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
  );
}
