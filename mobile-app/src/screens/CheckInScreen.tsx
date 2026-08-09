import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Button, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { PunchMethod } from '../types';
import type { EmployeeStackParamList } from '../../App';

type Mode = 'menu' | 'qr-scan' | 'selfie';
type Props = NativeStackScreenProps<EmployeeStackParamList, 'CheckIn'>;

export default function CheckInScreen({ navigation }: Props) {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [punchType, setPunchType] = useState<'0' | '1'>('0'); // 0 = in, 1 = out
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setEmployeeId(profile?.employee_id ?? null);
    });
  }, []);

  async function insertLog(payload: Partial<Record<string, unknown>> & { method: PunchMethod }) {
    if (!employeeId) return Alert.alert('No employee linked to this account');
    setBusy(true);
    const { error } = await supabase.from('attendance_logs').insert({
      employee_id: employeeId,
      punch_time: new Date().toISOString(),
      punch_type: punchType,
      ...payload,
    });
    setBusy(false);
    setMode('menu');
    if (error) Alert.alert('Check-in failed', error.message);
    else Alert.alert('Success', `${punchType === '0' ? 'Checked in' : 'Checked out'} via ${payload.method}`);
  }

  async function handleGpsCheckIn() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Location permission is required for GPS check-in');
    setBusy(true);
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setBusy(false);
    insertLog({
      method: 'gps',
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy_m: loc.coords.accuracy,
    });
  }

  async function openCamera(nextMode: 'qr-scan' | 'selfie') {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) return Alert.alert('Camera permission is required for this check-in method');
    }
    setMode(nextMode);
  }

  function handleQrScanned({ data }: BarcodeScanningResult) {
    setMode('menu');
    insertLog({ method: 'qr', qr_token_id: data });
  }

  async function handleSelfieCapture() {
    if (!cameraRef.current) return;
    setBusy(true);
    const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
    if (!photo) {
      setBusy(false);
      return Alert.alert('Could not capture photo, try again');
    }
    const fileName = `selfies/${employeeId}-${Date.now()}.jpg`;
    const response = await fetch(photo.uri);
    const blob = await response.blob();
    const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(fileName, blob, {
      contentType: 'image/jpeg',
    });
    setBusy(false);
    if (uploadError) return Alert.alert('Upload failed', uploadError.message);
    const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(fileName);
    insertLog({ method: 'selfie', selfie_url: publicUrl.publicUrl });
  }

  if (busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (mode === 'qr-scan') {
    return (
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleQrScanned}
      />
    );
  }

  if (mode === 'selfie') {
    return (
      <View style={{ flex: 1 }}>
        <CameraView style={{ flex: 1 }} facing="front" ref={cameraRef} />
        <View style={styles.captureBar}>
          <Button title="Capture" onPress={handleSelfieCapture} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.navRow}>
        <Text style={styles.navLink} onPress={() => navigation.navigate('History')}>
          My Attendance
        </Text>
        <Text style={styles.navLink} onPress={() => navigation.navigate('Leave')}>
          Leave
        </Text>
        <Text style={styles.navLink} onPress={() => supabase.auth.signOut()}>
          Sign out
        </Text>
      </View>
      <View style={styles.toggleRow}>
        <Button title="Check In" onPress={() => setPunchType('0')} color={punchType === '0' ? '#2563eb' : '#999'} />
        <Button title="Check Out" onPress={() => setPunchType('1')} color={punchType === '1' ? '#2563eb' : '#999'} />
      </View>
      <Text style={styles.hint}>Choose a verification method:</Text>
      <View style={styles.buttonGroup}>
        <Button title="📍 GPS Geofence" onPress={handleGpsCheckIn} />
        <View style={styles.spacer} />
        <Button title="▦ Scan Branch QR" onPress={() => openCamera('qr-scan')} />
        <View style={styles.spacer} />
        <Button title="🤳 Selfie" onPress={() => openCamera('selfie')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  navRow: { position: 'absolute', top: 16, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' },
  navLink: { color: '#2563eb', fontSize: 13, fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 32 },
  hint: { textAlign: 'center', marginBottom: 16, color: '#555' },
  buttonGroup: { gap: 12 },
  spacer: { height: 12 },
  captureBar: { position: 'absolute', bottom: 32, alignSelf: 'center' },
});
