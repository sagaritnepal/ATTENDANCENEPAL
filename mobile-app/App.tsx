import 'react-native-gesture-handler';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as LocalAuthentication from 'expo-local-authentication';
import { AuthProvider, useAuth } from './src/lib/AuthContext';
import { CalendarSystemProvider } from './src/lib/CalendarSystemContext';
import LoginScreen from './src/screens/LoginScreen';
import CheckInScreen from './src/screens/CheckInScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import LeaveRequestScreen from './src/screens/LeaveRequestScreen';
import EmployeesScreen from './src/screens/EmployeesScreen';
import EmployeeDetailScreen from './src/screens/EmployeeDetailScreen';
import AdminPayrollDetailScreen from './src/screens/AdminPayrollDetailScreen';
import PayrollScreen from './src/screens/PayrollScreen';
import TasksScreen from './src/screens/TasksScreen';
import DevicesScreen from './src/screens/DevicesScreen';
import LeaveApprovalScreen from './src/screens/LeaveApprovalScreen';
import CorrectionsScreen from './src/screens/CorrectionsScreen';
import BranchesScreen from './src/screens/BranchesScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import ShiftsScreen from './src/screens/ShiftsScreen';
import MyCalendarScreen from './src/screens/MyCalendarScreen';
import MyPayrollScreen from './src/screens/MyPayrollScreen';
import MyTasksScreen from './src/screens/MyTasksScreen';
import MyProfileScreen from './src/screens/MyProfileScreen';
import AdminHeader from './src/navigation/AdminHeader';
import AdminSidebarContent from './src/navigation/AdminSidebarContent';
import { colors } from './src/theme';
import { CalendarIcon, CardIcon, CheckCircleIcon, PersonIcon, TaskIcon } from './src/components/icons';

// Employee-facing flow mirrors admin-web's EmployeeShell: a 5-tab bottom bar
// (Check In/Out, Calendar, Payroll, Tasks, Profile) with Leave reached as a
// sub-page pushed from Check In/Out, not its own tab — same as the web.
export type EmployeeTabParamList = {
  CheckIn: undefined;
  Calendar: undefined;
  Payroll: undefined;
  Tasks: undefined;
  Profile: undefined;
};
const EmployeeTab = createBottomTabNavigator<EmployeeTabParamList>();

export type EmployeeStackParamList = {
  EmployeeTabs: undefined;
  Leave: undefined;
};
const EmployeeStack = createNativeStackNavigator<EmployeeStackParamList>();

function EmployeeTabNavigator() {
  return (
    <EmployeeTab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTintColor: colors.ink,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.slate200 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.slate400,
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      <EmployeeTab.Screen
        name="CheckIn"
        component={CheckInScreen}
        options={{ title: 'Check In/Out', tabBarLabel: 'Check In/Out', tabBarIcon: ({ color, size }) => <CheckCircleIcon size={size} color={color} /> }}
      />
      <EmployeeTab.Screen
        name="Calendar"
        component={MyCalendarScreen}
        options={{ title: 'Calendar', tabBarIcon: ({ color, size }) => <CalendarIcon size={size} color={color} /> }}
      />
      <EmployeeTab.Screen
        name="Payroll"
        component={MyPayrollScreen}
        options={{ title: 'Payroll', tabBarIcon: ({ color, size }) => <CardIcon size={size} color={color} /> }}
      />
      <EmployeeTab.Screen
        name="Tasks"
        component={MyTasksScreen}
        options={{ title: 'My Tasks', tabBarIcon: ({ color, size }) => <TaskIcon size={size} color={color} /> }}
      />
      <EmployeeTab.Screen
        name="Profile"
        component={MyProfileScreen}
        options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <PersonIcon size={size} color={color} /> }}
      />
    </EmployeeTab.Navigator>
  );
}

// Admin flow mirrors admin-web's AppShell: a left sidebar (here, a slide-out
// drawer since a phone has no room for a permanent one) with the same nav
// groups, and every screen wrapped in its own single-screen stack purely so
// each one gets the same shared header (menu button + title + bell +
// device count + account avatar) instead of the drawer's own header.
const Drawer = createDrawerNavigator();
const DashboardStack = createNativeStackNavigator();
const EmployeesAdminStack = createNativeStackNavigator();
const AttendanceAdminStack = createNativeStackNavigator();
const PayrollAdminStack = createNativeStackNavigator();
const TasksAdminStack = createNativeStackNavigator();
const DevicesAdminStack = createNativeStackNavigator();

function DashboardStackScreen() {
  return (
    <DashboardStack.Navigator screenOptions={{ header: props => <AdminHeader {...props} /> }}>
      <DashboardStack.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Live Dashboard' }} />
    </DashboardStack.Navigator>
  );
}
function EmployeesStackScreen() {
  return (
    <EmployeesAdminStack.Navigator screenOptions={{ header: props => <AdminHeader {...props} /> }}>
      <EmployeesAdminStack.Screen name="EmployeesList" component={EmployeesScreen} options={{ title: 'Employees' }} />
      <EmployeesAdminStack.Screen name="EmployeeDetail" component={EmployeeDetailScreen} options={{ title: 'Employee Details' }} />
      <EmployeesAdminStack.Screen name="Shifts" component={ShiftsScreen} options={{ title: 'Shift Roster Management' }} />
      <EmployeesAdminStack.Screen name="Branches" component={BranchesScreen} options={{ title: 'Branch / Department' }} />
    </EmployeesAdminStack.Navigator>
  );
}
function AttendanceStackScreen() {
  return (
    <AttendanceAdminStack.Navigator screenOptions={{ header: props => <AdminHeader {...props} /> }}>
      <AttendanceAdminStack.Screen name="AttendanceList" component={HistoryScreen} options={{ title: 'Attendance' }} />
      <AttendanceAdminStack.Screen name="Leave" component={LeaveApprovalScreen} options={{ title: 'Leave Requests' }} />
      <AttendanceAdminStack.Screen name="Corrections" component={CorrectionsScreen} options={{ title: 'Attendance Corrections' }} />
      <AttendanceAdminStack.Screen name="Calendar" component={CalendarScreen} options={{ title: 'Attendance Calendar' }} />
    </AttendanceAdminStack.Navigator>
  );
}
function PayrollStackScreen() {
  return (
    <PayrollAdminStack.Navigator screenOptions={{ header: props => <AdminHeader {...props} /> }}>
      <PayrollAdminStack.Screen name="Payroll" component={PayrollScreen} options={{ title: 'Payroll' }} />
      <PayrollAdminStack.Screen name="PayrollDetail" component={AdminPayrollDetailScreen} options={{ title: 'Payroll Detail' }} />
    </PayrollAdminStack.Navigator>
  );
}
function TasksStackScreen() {
  return (
    <TasksAdminStack.Navigator screenOptions={{ header: props => <AdminHeader {...props} /> }}>
      <TasksAdminStack.Screen name="Tasks" component={TasksScreen} options={{ title: 'Tasks & Rewards' }} />
    </TasksAdminStack.Navigator>
  );
}
function DevicesStackScreen() {
  return (
    <DevicesAdminStack.Navigator screenOptions={{ header: props => <AdminHeader {...props} /> }}>
      <DevicesAdminStack.Screen name="Devices" component={DevicesScreen} options={{ title: 'Biometric Sync Devices' }} />
    </DevicesAdminStack.Navigator>
  );
}

function AdminDrawerNavigator() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  return (
    <Drawer.Navigator
      drawerContent={props => <AdminSidebarContent {...props} />}
      screenOptions={{ headerShown: false, drawerType: 'front', overlayColor: 'rgba(0,0,0,0.4)', drawerStyle: { width: 240 } }}
    >
      <Drawer.Screen name="Dashboard" component={DashboardStackScreen} />
      <Drawer.Screen name="Employees" component={EmployeesStackScreen} />
      <Drawer.Screen name="Attendance" component={AttendanceStackScreen} />
      <Drawer.Screen name="Payroll" component={PayrollStackScreen} />
      <Drawer.Screen name="Tasks" component={TasksStackScreen} />
      {isAdmin && <Drawer.Screen name="Devices" component={DevicesStackScreen} />}
    </Drawer.Navigator>
  );
}

function AppInner() {
  const { session, profile, loading } = useAuth();

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
          {!session ? (
            <LoginScreen />
          ) : profile?.role === 'admin' || profile?.role === 'hr' ? (
            <AdminDrawerNavigator />
          ) : (
            <EmployeeStack.Navigator
              screenOptions={{
                headerStyle: { backgroundColor: colors.white },
                headerTintColor: colors.ink,
                headerTitleStyle: { fontWeight: '700' },
              }}
            >
              <EmployeeStack.Screen name="EmployeeTabs" component={EmployeeTabNavigator} options={{ headerShown: false }} />
              <EmployeeStack.Screen name="Leave" component={LeaveRequestScreen} options={{ title: 'Leave Requests' }} />
            </EmployeeStack.Navigator>
          )}
        </NavigationContainer>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <CalendarSystemProvider>
          <AppInner />
        </CalendarSystemProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

// On an actual phone this is a no-op (the card already fills the viewport).
// On a desktop browser it keeps the app from stretching edge-to-edge into an
// unusably wide layout, centering it as a phone-width card instead.
const styles = StyleSheet.create({
  webOuter: (Platform.OS === 'web'
    ? { flex: 1, alignItems: 'center', backgroundColor: colors.slate200, minHeight: '100vh' }
    : { flex: 1 }) as object,
  webInner: (Platform.OS === 'web'
    ? { flex: 1, width: '100%', maxWidth: 480, backgroundColor: colors.white, boxShadow: '0 0 24px rgba(0,0,0,0.08)' }
    : { flex: 1 }) as object,
  lockScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // The web app has no equivalent screen — this borrows the sidebar's real
    // dark navy instead of a made-up color, so it still reads as "this app"
    // rather than an unrelated shade.
    backgroundColor: colors.sidebar,
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
  lockTitle: { fontSize: 20, fontWeight: '700', color: colors.white, marginBottom: 6 },
  lockSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 24 },
  unlockButton: { backgroundColor: colors.accent, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 10 },
  unlockButtonText: { color: colors.white, fontSize: 15, fontWeight: '600' },
});
