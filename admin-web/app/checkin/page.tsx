'use client';

import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import type { CorrectionRequest } from '@/lib/types';

type Mode = 'menu' | 'qr-scan' | 'selfie';
type View = 'live' | 'fix';

const EMPTY_CORRECTION_FORM = { work_date: '', check_in_time: '', check_out_time: '', reason: '' };

function toTimestamp(date: string, time: string) {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function CheckInPage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [view, setView] = useState<View>('live');

  // Live check-in/out state
  const [punchType, setPunchType] = useState<'0' | '1'>('0');
  const [mode, setMode] = useState<Mode>('menu');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'good' | 'critical'; text: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);

  // Fix-a-missed-punch state
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [correctionForm, setCorrectionForm] = useState(EMPTY_CORRECTION_FORM);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

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

  useEffect(() => {
    if (view !== 'fix' || !employeeId) return;
    reloadCorrections(employeeId);
  }, [view, employeeId]);

  function reloadCorrections(empId: string) {
    supabase
      .from('attendance_correction_requests')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests(data ?? []));
  }

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

  async function handleCorrectionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    setCorrectionError(null);
    const checkIn = toTimestamp(correctionForm.work_date, correctionForm.check_in_time);
    const checkOut = toTimestamp(correctionForm.work_date, correctionForm.check_out_time);
    if (!correctionForm.work_date || (!checkIn && !checkOut)) {
      setCorrectionError('Pick a date and at least one of check-in or check-out time.');
      return;
    }
    setSubmittingCorrection(true);
    const { error: insertError } = await supabase.from('attendance_correction_requests').insert({
      employee_id: employeeId,
      work_date: correctionForm.work_date,
      requested_check_in: checkIn,
      requested_check_out: checkOut,
      reason: correctionForm.reason || null,
    });
    setSubmittingCorrection(false);
    if (insertError) {
      setCorrectionError(insertError.message);
      return;
    }
    setCorrectionForm(EMPTY_CORRECTION_FORM);
    reloadCorrections(employeeId);
  }

  function statusTone(status: string) {
    if (status === 'approved') return 'good' as const;
    if (status === 'rejected') return 'critical' as const;
    return 'warning' as const;
  }

  if (mode === 'qr-scan' || mode === 'selfie') {
    return (
      <EmployeeShell title="Check In/Out">
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
    <EmployeeShell title="Check In/Out">
      <div className="mb-4 flex overflow-hidden rounded-xl border border-slate-200 bg-white text-sm font-semibold">
        <button
          onClick={() => setView('live')}
          className={`flex-1 py-2.5 ${view === 'live' ? 'bg-accent text-white' : 'text-slate-500'}`}
        >
          Check In/Out
        </button>
        <button
          onClick={() => setView('fix')}
          className={`flex-1 py-2.5 ${view === 'fix' ? 'bg-accent text-white' : 'text-slate-500'}`}
        >
          Fix a Missed Punch
        </button>
      </div>

      {view === 'live' ? (
        <>
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
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500">Forgot to check in or out? Request a correction and HR/Admin will review it.</p>

          <form onSubmit={handleCorrectionSubmit} className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
            <input
              type="date"
              required
              value={correctionForm.work_date}
              onChange={e => setCorrectionForm(f => ({ ...f, work_date: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Check-in time</label>
                <input
                  type="time"
                  value={correctionForm.check_in_time}
                  onChange={e => setCorrectionForm(f => ({ ...f, check_in_time: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Check-out time</label>
                <input
                  type="time"
                  value={correctionForm.check_out_time}
                  onChange={e => setCorrectionForm(f => ({ ...f, check_out_time: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Reason (optional)</label>
            <textarea
              value={correctionForm.reason}
              onChange={e => setCorrectionForm(f => ({ ...f, reason: e.target.value }))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              rows={2}
            />
            {correctionError && <p className="mb-3 text-sm text-critical">{correctionError}</p>}
            <button
              type="submit"
              disabled={submittingCorrection || !employeeId}
              className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {submittingCorrection ? 'Submitting…' : 'Submit request'}
            </button>
            {!employeeId && (
              <p className="mt-2 text-xs text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
            )}
          </form>

          <h2 className="mb-3 text-sm font-semibold text-ink">My requests</h2>
          {requests.length === 0 ? (
            <p className="text-center text-sm text-slate-400">No correction requests yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {requests.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-ink">{r.work_date}</div>
                    <div className="text-xs text-slate-400">
                      In {formatTime(r.requested_check_in)} · Out {formatTime(r.requested_check_out)}
                    </div>
                    {r.reason && <div className="text-xs text-slate-400">{r.reason}</div>}
                  </div>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </EmployeeShell>
  );
}
