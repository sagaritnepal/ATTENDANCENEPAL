'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import type { CorrectionRequest } from '@/lib/types';

type View = 'live' | 'fix';
type PunchModal = {
  punchType: '0' | '1';
  punchTime: string;
  status: 'locating' | 'ready' | 'error';
  coords?: { lat: number; lng: number; accuracy: number };
  error?: string;
};

const EMPTY_CORRECTION_FORM = { work_date: '', check_in_time: '', check_out_time: '', reason: '' };

function toTimestamp(date: string, time: string) {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

function formatTime(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Best-effort, never blocks the caller — a denied/unavailable location
 * just means the request is submitted without coordinates. */
function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

export default function CheckInPage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [view, setView] = useState<View>('live');

  // Live check-in/out state
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'good' | 'critical'; text: string } | null>(null);
  const [modal, setModal] = useState<PunchModal | null>(null);

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

  function locate(base: PunchModal) {
    if (!navigator.geolocation) {
      setModal({ ...base, status: 'error', error: 'This browser does not support location access.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos =>
        setModal(m =>
          m
            ? { ...m, status: 'ready', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } }
            : m
        ),
      err => setModal(m => (m ? { ...m, status: 'error', error: err.message } : m)),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  function openPunchModal(punchType: '0' | '1') {
    if (!employeeId) {
      setMessage({ kind: 'critical', text: 'No employee linked to this account.' });
      return;
    }
    const base: PunchModal = { punchType, punchTime: new Date().toISOString(), status: 'locating' };
    setModal(base);
    locate(base);
  }

  function retryLocate() {
    if (!modal) return;
    const base: PunchModal = { punchType: modal.punchType, punchTime: modal.punchTime, status: 'locating' };
    setModal(base);
    locate(base);
  }

  async function confirmPunch() {
    if (!modal || modal.status !== 'ready' || !modal.coords || !employeeId) return;
    setBusy(true);
    const { error } = await supabase.from('attendance_logs').insert({
      employee_id: employeeId,
      punch_time: modal.punchTime,
      punch_type: modal.punchType,
      method: 'gps',
      lat: modal.coords.lat,
      lng: modal.coords.lng,
      accuracy_m: modal.coords.accuracy,
    });
    setBusy(false);
    const punchType = modal.punchType;
    setModal(null);
    if (error) setMessage({ kind: 'critical', text: `Check-in failed: ${error.message}` });
    else setMessage({ kind: 'good', text: punchType === '0' ? 'Checked in.' : 'Checked out.' });
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
    const coords = await getCurrentCoords();
    const { error: insertError } = await supabase.from('attendance_correction_requests').insert({
      employee_id: employeeId,
      work_date: correctionForm.work_date,
      requested_check_in: checkIn,
      requested_check_out: checkOut,
      reason: correctionForm.reason || null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
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

          <p className="mb-3 text-sm font-medium text-slate-600">Uses your current GPS location:</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => openPunchModal('0')}
              disabled={!employeeId}
              className="rounded-xl bg-green-600 py-4 text-base font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
            >
              📍 Check In
            </button>
            <button
              onClick={() => openPunchModal('1')}
              disabled={!employeeId}
              className="rounded-xl bg-green-600 py-4 text-base font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
            >
              📍 Check Out
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-4 text-sm text-slate-500">
            Forgot to check in or out? Request a correction and HR/Admin will review it. Your current location is
            captured automatically as confirmation.
          </p>

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

      {modal && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-1 text-lg font-semibold text-ink">
              Confirm {modal.punchType === '0' ? 'Check In' : 'Check Out'}
            </h3>
            <p className="mb-4 text-xs text-slate-500">{new Date(modal.punchTime).toLocaleString()}</p>

            {modal.status === 'locating' && <p className="mb-4 text-sm text-slate-500">📍 Getting your location…</p>}
            {modal.status === 'ready' && <p className="mb-4 text-sm text-good-text">📍 Location confirmed</p>}
            {modal.status === 'error' && (
              <div className="mb-4">
                <p className="mb-2 text-sm text-critical">📍 {modal.error ?? 'Could not get your location.'}</p>
                <button onClick={retryLocate} className="text-xs font-medium text-accent hover:underline">
                  Try again
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setModal(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={confirmPunch}
                disabled={modal.status !== 'ready' || busy}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </EmployeeShell>
  );
}
