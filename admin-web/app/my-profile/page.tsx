'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import type { Employee, LeaderboardRow, PointRedemption } from '@/lib/types';

const EMPTY_PROFILE_FORM = { name: '', email: '', phone: '', address: '', department: '', designation: '' };

function tenureDays(dateOfJoining: string | null, resignedAt: string | null) {
  if (!dateOfJoining) return null;
  const start = new Date(dateOfJoining).getTime();
  const end = resignedAt ? new Date(resignedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function statusTone(status: string) {
  if (status === 'approved') return 'good' as const;
  if (status === 'rejected') return 'critical' as const;
  return 'warning' as const;
}

export default function MyProfilePage() {
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<LeaderboardRow | null>(null);
  const [redemptions, setRedemptions] = useState<PointRedemption[]>([]);

  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [redeemNote, setRedeemNote] = useState('');
  const [submittingRedeem, setSubmittingRedeem] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);

  function reload(empId: string) {
    supabase
      .from('employees')
      .select('*')
      .eq('id', empId)
      .single()
      .then(({ data }) => {
        if (data) {
          setEmployee(data);
          setProfileForm({
            name: data.name ?? '',
            email: data.email ?? '',
            phone: data.phone ?? '',
            address: data.address ?? '',
            department: data.department ?? '',
            designation: data.designation ?? '',
          });
        }
      });
    supabase
      .from('point_redemptions')
      .select('*')
      .eq('employee_id', empId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRedemptions(data ?? []));
    supabase.rpc('get_leaderboard').then(({ data }) => {
      const rows = (data as LeaderboardRow[]) ?? [];
      setBoard(rows.find(r => r.employee_id === empId) ?? null);
    });
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (profile?.employee_id) reload(profile.employee_id);
    });
  }, []);

  async function saveProfile(photoUrl: string | null) {
    const { error } = await supabase.rpc('update_my_profile', {
      p_name: profileForm.name,
      p_email: profileForm.email || null,
      p_phone: profileForm.phone || null,
      p_address: profileForm.address || null,
      p_department: profileForm.department || null,
      p_designation: profileForm.designation || null,
      p_photo_url: photoUrl,
    });
    return error;
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    const error = await saveProfile(employee.profile_photo_url);
    setSavingProfile(false);
    if (error) {
      setProfileError(error.message);
      return;
    }
    setProfileSaved(true);
    reload(employee.id);
  }

  function openPhotoPicker() {
    photoInputRef.current?.click();
  }

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !employee) return;

    setUploadingPhoto(true);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `employee-photos/${employee.id}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(path, file, {
      contentType: file.type || 'image/jpeg',
    });
    if (uploadError) {
      setUploadingPhoto(false);
      alert(`Photo upload failed: ${uploadError.message}`);
      return;
    }
    const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(path);
    const rpcError = await saveProfile(publicUrl.publicUrl);
    setUploadingPhoto(false);
    if (rpcError) {
      alert(`Could not save photo: ${rpcError.message}`);
      return;
    }
    reload(employee.id);
  }

  async function handleRedeemSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setRedeemError(null);
    if (redeemPoints <= 0) {
      setRedeemError('Enter how many points you want to redeem.');
      return;
    }
    if (board && redeemPoints > board.total_points) {
      setRedeemError(`You only have ${board.total_points} points available.`);
      return;
    }
    setSubmittingRedeem(true);
    const { error } = await supabase.from('point_redemptions').insert({
      employee_id: employee.id,
      points_requested: redeemPoints,
      note: redeemNote || null,
    });
    setSubmittingRedeem(false);
    if (error) {
      setRedeemError(error.message);
      return;
    }
    setShowRedeem(false);
    setRedeemPoints(0);
    setRedeemNote('');
    reload(employee.id);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  function updateField(key: keyof typeof EMPTY_PROFILE_FORM, value: string) {
    setProfileForm(f => ({ ...f, [key]: value }));
    setProfileSaved(false);
  }

  if (loading) {
    return (
      <EmployeeShell title="Profile">
        <p className="text-center text-sm text-slate-400">Loading…</p>
      </EmployeeShell>
    );
  }

  if (!employee) {
    return (
      <EmployeeShell title="Profile">
        <p className="mt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      </EmployeeShell>
    );
  }

  const days = tenureDays(employee.date_of_joining, employee.resigned_at);

  return (
    <EmployeeShell title="Profile">
      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />

      <div className="mb-5 flex flex-col items-center rounded-xl border border-slate-200 bg-white p-6">
        <button
          onClick={openPhotoPicker}
          title="Change photo"
          className="relative mb-3 h-20 w-20 overflow-hidden rounded-full bg-accent/10 text-2xl font-semibold text-accent"
        >
          {uploadingPhoto ? (
            <span className="flex h-full w-full items-center justify-center text-sm">…</span>
          ) : employee.profile_photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={employee.profile_photo_url} alt={employee.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center">{employee.name.slice(0, 1)}</span>
          )}
        </button>
        <button onClick={openPhotoPicker} className="mb-2 text-xs font-medium text-accent hover:underline">
          Change photo
        </button>
        <h1 className="text-lg font-semibold text-ink">{employee.name}</h1>
        <p className="text-sm text-slate-500">{employee.designation ?? '—'}</p>
        <p className="text-xs text-slate-400">{employee.department ?? '—'}</p>
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-slate-500">Reward points</span>
          <span className="text-2xl font-bold text-ink">{board?.total_points ?? 0}</span>
        </div>
        <button
          onClick={() => setShowRedeem(true)}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white hover:bg-accent/90"
        >
          Redeem points
        </button>

        {redemptions.length > 0 && (
          <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100 pt-2">
            {redemptions.map(r => (
              <div key={r.id} className="flex items-center gap-3 py-2">
                <div className="flex-1">
                  <div className="text-sm text-ink">{r.points_requested} pts</div>
                  {r.note && <div className="text-xs text-slate-400">{r.note}</div>}
                </div>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Employment</h2>
        <p className="mb-3 text-xs text-slate-400">Set by HR/Admin — not editable here.</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Date of joining</span>
            <span className="text-ink">{employee.date_of_joining ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">{employee.resigned_at ? 'Days worked' : 'Days with company'}</span>
            <span className="text-ink">{days !== null ? `${days} days` : '—'}</span>
          </div>
          {employee.resigned_at && (
            <div className="flex justify-between">
              <span className="text-slate-400">Resigned</span>
              <span className="text-ink">{employee.resigned_at}</span>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSaveProfile} className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">My Details</h2>

        <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
        <input
          required
          value={profileForm.name}
          onChange={e => updateField('name', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
        <input
          type="email"
          value={profileForm.email}
          onChange={e => updateField('email', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
        <input
          value={profileForm.phone}
          onChange={e => updateField('phone', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Address</label>
        <textarea
          value={profileForm.address}
          onChange={e => updateField('address', e.target.value)}
          rows={2}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Department</label>
        <input
          value={profileForm.department}
          onChange={e => updateField('department', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <label className="mb-1 block text-xs font-medium text-slate-600">Designation</label>
        <input
          value={profileForm.designation}
          onChange={e => updateField('designation', e.target.value)}
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />

        {profileError && <p className="mb-3 text-sm text-critical">{profileError}</p>}
        {profileSaved && <p className="mb-3 text-sm text-good-text">Saved.</p>}
        <button
          type="submit"
          disabled={savingProfile}
          className="w-full rounded-lg bg-accent py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {savingProfile ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <button
        onClick={handleSignOut}
        className="mb-6 w-full rounded-lg border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        Sign out
      </button>

      {showRedeem && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={handleRedeemSubmit} className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="mb-1 text-lg font-semibold text-ink">Redeem Points</h3>
            <p className="mb-4 text-xs text-slate-500">You have {board?.total_points ?? 0} points. HR/Admin will review this request.</p>

            <label className="mb-1 block text-xs font-medium text-slate-600">Points to redeem</label>
            <input
              type="number"
              min={1}
              max={board?.total_points ?? undefined}
              required
              value={redeemPoints || ''}
              onChange={e => setRedeemPoints(Number(e.target.value))}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-xs font-medium text-slate-600">Note (optional)</label>
            <textarea
              value={redeemNote}
              onChange={e => setRedeemNote(e.target.value)}
              rows={2}
              className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            {redeemError && <p className="mb-3 text-sm text-critical">{redeemError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowRedeem(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingRedeem}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {submittingRedeem ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </form>
        </div>
      )}
    </EmployeeShell>
  );
}
