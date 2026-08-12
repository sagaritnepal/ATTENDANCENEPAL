import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Requests notification permission, gets this device's Expo push token,
 * and upserts it against the logged-in employee's row in `push_tokens`
 * (RLS restricts each user to writing only their own row). Call once the
 * employee_id is known (see AuthContext.tsx) — safe to call again on every
 * login, it just overwrites the same row.
 *
 * Physical device + a real EAS projectId are both required for a token to
 * actually be issued (simulators and a placeholder projectId silently
 * no-op instead of throwing, so this never blocks the rest of the app). */
export async function registerForPushNotifications(employeeId: string): Promise<void> {
  if (!Device.isDevice) return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId || projectId === 'REPLACE_WITH_EAS_PROJECT_ID') return;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });

  await supabase.from('push_tokens').upsert(
    { employee_id: employeeId, expo_push_token: pushToken.data, updated_at: new Date().toISOString() },
    { onConflict: 'employee_id' }
  );
}
