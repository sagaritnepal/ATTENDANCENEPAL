'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';

type Mode = 'menu' | 'qr-scan' | 'selfie';

export default function CheckInPage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [punchType, setPunchType] = useState<'0' | '1'>('0');
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'good' | 'critical'; text: string } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);

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

  useEffect(() => {
    return () => stopCamera();
  }, []);

  function stopCamera() {
    if (scanFrameRef.current) cancelAnimationFrame(scanFrameRef.current);
    scanFrameRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }

  async function insertLog(payload: Record<string, unknown> & { method: string }) {
    if (!employeeId) {
      setMessage({ kind: 'critical', text: 'No employee linked to this account.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('attendance_logs').insert({
      employee_id: employeeId,
      punch_time: new Date().toISOString(),
      punch_type: punchType,
      ...payload,
    });
    setBusy(false);
    setMode('menu');
    if (error) setMessage({ kind: 'critical', text: `Check-in failed: ${error.message}` });
    else setMessage({ kind: 'good', text: `${punchType === '0' ? 'Checked in' : 'Checked out'} via ${payload.method}.` });
  }

  async function handleGpsCheckIn() {
    if (!navigator.geolocation) {
      setMessage({ kind: 'critical', text: 'This browser does not support location access.' });
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setBusy(false);
        insertLog({
          method: 'gps',
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
        });
      },
      err => {
        setBusy(false);
        setMessage({ kind: 'critical', text: `Location permission denied or unavailable: ${err.message}` });
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function openCamera(nextMode: 'qr-scan' | 'selfie') {
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextMode === 'selfie' ? 'user' : 'environment' },
      });
      streamRef.current = stream;
      setMode(nextMode);
      // The <video> only exists once `mode` re-renders it in; attach next tick.
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          if (nextMode === 'qr-scan') scanLoop();
        }
      }, 0);
    } catch {
      setMessage({ kind: 'critical', text: 'Camera permission is required for this check-in method.' });
    }
  }

  function scanLoop() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      scanFrameRef.current = requestAnimationFrame(scanLoop);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code) {
      stopCamera();
      setMode('menu');
      insertLog({ method: 'qr', qr_token_id: code.data });
      return;
    }
    scanFrameRef.current = requestAnimationFrame(scanLoop);
  }

  async function handleSelfieCapture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async blob => {
      if (!blob) return;
      stopCamera();
      setBusy(true);
      const fileName = `selfies/${employeeId}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(fileName, blob, {
        contentType: 'image/jpeg',
      });
      if (uploadError) {
        setBusy(false);
        setMode('menu');
        setMessage({ kind: 'critical', text: `Upload failed: ${uploadError.message}` });
        return;
      }
      const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(fileName);
      setBusy(false);
      insertLog({ method: 'selfie', selfie_url: publicUrl.publicUrl });
    }, 'image/jpeg', 0.85);
  }

  function cancelCamera() {
    stopCamera();
    setMode('menu');
  }

  if (mode === 'qr-scan' || mode === 'selfie') {
    return (
      <EmployeeShell title="Check In / Out">
        <div className="relative overflow-hidden rounded-xl bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted className="w-full" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent p-4">
            {mode === 'selfie' && (
              <button
                onClick={handleSelfieCapture}
                disabled={busy}
                className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-ink disabled:opacity-60"
              >
                Capture
              </button>
            )}
            <button
              onClick={cancelCamera}
              className="rounded-full border border-white/60 px-6 py-3 text-sm font-semibold text-white"
            >
              Cancel
            </button>
          </div>
        </div>
        {mode === 'qr-scan' && <p className="mt-3 text-center text-xs text-slate-500">Point the camera at your branch&apos;s QR code.</p>}
      </EmployeeShell>
    );
  }

  return (
    <EmployeeShell title="Check In / Out">
      {message && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm ${message.kind === 'good' ? 'bg-good-bg text-good-text' : 'bg-critical-bg text-critical-text'}`}>
          {message.text}
        </div>
      )}

      <div className="mb-6 flex overflow-hidden rounded-xl border border-slate-200 bg-white">
        <button
          onClick={() => setPunchType('0')}
          className={`flex-1 py-3 text-sm font-semibold ${punchType === '0' ? 'bg-accent text-white' : 'text-slate-500'}`}
        >
          Check In
        </button>
        <button
          onClick={() => setPunchType('1')}
          className={`flex-1 py-3 text-sm font-semibold ${punchType === '1' ? 'bg-accent text-white' : 'text-slate-500'}`}
        >
          Check Out
        </button>
      </div>

      <p className="mb-3 text-sm font-medium text-slate-600">Choose a verification method:</p>
      <div className="flex flex-col gap-3">
        <button
          onClick={handleGpsCheckIn}
          disabled={busy || !employeeId}
          className="rounded-xl border border-slate-200 bg-white py-4 text-base font-semibold text-ink shadow-sm disabled:opacity-50"
        >
          📍 GPS Geofence
        </button>
        <button
          onClick={() => openCamera('qr-scan')}
          disabled={busy || !employeeId}
          className="rounded-xl border border-slate-200 bg-white py-4 text-base font-semibold text-ink shadow-sm disabled:opacity-50"
        >
          ▦ Scan Branch QR
        </button>
        <button
          onClick={() => openCamera('selfie')}
          disabled={busy || !employeeId}
          className="rounded-xl border border-slate-200 bg-white py-4 text-base font-semibold text-ink shadow-sm disabled:opacity-50"
        >
          🤳 Selfie
        </button>
      </div>
    </EmployeeShell>
  );
}
