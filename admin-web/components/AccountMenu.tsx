'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import PhotoCropModal from './PhotoCropModal';

type ProfileForm = { full_name: string; company_name: string; pan_no: string; location: string };
const EMPTY_FORM: ProfileForm = { full_name: '', company_name: '', pan_no: '', location: '' };

type ProfileSummary = ProfileForm & { email: string; created_at: string | null; photo_url: string | null };

/** The account block (avatar, name, role) — moved here from the bottom of
 * the sidebar into the top-right of every page, with a dropdown for Edit
 * Profile / Sign out instead of a bare Sign out link. */
export default function AccountMenu({ adminName, role }: { adminName: string; role: 'admin' | 'hr' }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Fetched once on mount (not on every dropdown open) — the same data
  // backs both the dropdown's info card and the Edit Profile form, so
  // opening either is instant instead of waiting on a fresh round trip.
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data: userData }) => {
      if (!active || !userData.user) return;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, company_name, pan_no, location, created_at, photo_url')
        .eq('id', userData.user.id)
        .single();
      if (!active) return;
      setProfile({
        email: userData.user.email ?? '',
        full_name: data?.full_name ?? '',
        company_name: data?.company_name ?? '',
        pan_no: data?.pan_no ?? '',
        location: data?.location ?? '',
        created_at: data?.created_at ?? null,
        photo_url: data?.photo_url ?? null,
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  function openEditProfile() {
    setOpen(false);
    setError(null);
    setForm({
      full_name: profile?.full_name ?? '',
      company_name: profile?.company_name ?? '',
      pan_no: profile?.pan_no ?? '',
      location: profile?.location ?? '',
    });
    setShowEdit(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setSaving(false);
      setError('Your session expired — please sign in again.');
      return;
    }
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        full_name: form.full_name.trim() || null,
        company_name: form.company_name.trim() || null,
        pan_no: form.pan_no.trim() || null,
        location: form.location.trim() || null,
      })
      .eq('id', userData.user.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    // adminName lives in AppShell's own state, fetched once on mount — a
    // reload is the simplest way to make a changed name show up in the
    // header/sidebar immediately instead of threading a refetch callback
    // through three components.
    window.location.reload();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  function openPhotoPicker() {
    photoInputRef.current?.click();
  }

  function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPendingPhotoFile(file);
  }

  // Same bucket/path convention as the employee self-service photo (see
  // my-profile/page.tsx) — 'attendance-selfies' already allows any
  // authenticated user to upload, and profiles.photo_url is on the
  // explicit self-update column allowlist (20260809110000_profile_photo.sql).
  async function handlePhotoCropped(blob: Blob) {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      alert('Your session expired — please sign in again.');
      return;
    }
    setUploadingPhoto(true);
    try {
      const path = `admin-photos/${userData.user.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage.from('attendance-selfies').upload(path, blob, {
        contentType: 'image/jpeg',
      });
      if (uploadError) {
        alert(`Photo upload failed: ${uploadError.message}`);
        return;
      }
      const { data: publicUrl } = supabase.storage.from('attendance-selfies').getPublicUrl(path);
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ photo_url: publicUrl.publicUrl })
        .eq('id', userData.user.id);
      if (updateError) {
        alert(`Could not save photo: ${updateError.message}`);
        return;
      }
      setProfile(p => (p ? { ...p, photo_url: publicUrl.publicUrl } : p));
      setPendingPhotoFile(null);
    } finally {
      setUploadingPhoto(false);
    }
  }

  function openPasswordModal() {
    setOpen(false);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError(null);
    setPasswordSuccess(false);
    setShowPassword(true);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setChangingPassword(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (updateError) {
      setPasswordError(updateError.message);
      return;
    }
    setPasswordSuccess(true);
    setNewPassword('');
    setConfirmPassword('');
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/10 text-sm font-semibold text-accent">
            {profile?.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.photo_url} alt={adminName} className="h-full w-full object-cover" />
            ) : (
              adminName.slice(0, 1).toUpperCase()
            )}
          </span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block max-w-[9rem] truncate text-sm font-medium text-ink">{adminName}</span>
            <span className="block text-xs text-slate-400">{role === 'admin' ? 'System Administrator' : 'HR'}</span>
          </span>
          <ChevronIcon className={`hidden h-4 w-4 shrink-0 text-slate-400 transition-transform sm:block ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-accent/15 via-accent/5 to-transparent p-4">
              <div className="min-w-0 pt-1">
                <div className="truncate text-sm font-semibold text-ink">{adminName}</div>
                <div className="text-xs text-slate-500">{role === 'admin' ? 'System Administrator' : 'HR'}</div>
              </div>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-lg font-semibold text-white shadow-sm ring-2 ring-white">
                {profile?.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.photo_url} alt={adminName} className="h-full w-full object-cover" />
                ) : (
                  adminName.slice(0, 1).toUpperCase()
                )}
              </span>
            </div>

            <div className="space-y-2.5 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-500">
                  <MailIcon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{profile?.email || '—'}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-purple-50 text-purple-500">
                  <BuildingIcon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{profile?.company_name || 'No company set'}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-orange-50 text-orange-500">
                  <PinIcon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{profile?.location || 'No address set'}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-good-bg text-good-text">
                  <CalendarDotIcon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">
                  Member since{' '}
                  {profile?.created_at
                    ? new Date(profile.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-3">
              <button
                onClick={openEditProfile}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent/90"
              >
                <EditIcon className="h-3.5 w-3.5" />
                Edit Profile
              </button>
              <button
                onClick={openPasswordModal}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <KeyIcon className="h-3.5 w-3.5" />
                Change Password
              </button>
              <button
                onClick={handleSignOut}
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-critical-bg px-3 py-2 text-xs font-semibold text-critical-text transition-colors hover:bg-critical/20"
              >
                <SignOutIcon className="h-3.5 w-3.5" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      {showEdit && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowEdit(false)}>
          <form
            onSubmit={handleSave}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
          >
            <h3 className="mb-4 text-lg font-semibold text-ink">Edit Profile</h3>

            <div className="mb-4 flex flex-col items-center">
              <button
                type="button"
                onClick={openPhotoPicker}
                title="Change photo"
                className="relative mb-2 h-20 w-20 overflow-hidden rounded-full bg-accent/10 text-2xl font-semibold text-accent"
              >
                {uploadingPhoto ? (
                  <span className="flex h-full w-full items-center justify-center text-sm">…</span>
                ) : profile?.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={profile.photo_url} alt={adminName} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">{adminName.slice(0, 1).toUpperCase()}</span>
                )}
              </button>
              <button type="button" onClick={openPhotoPicker} className="text-xs font-medium text-accent hover:underline">
                Change photo
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
                <input
                  value={profile?.email ?? ''}
                  disabled
                  title="Sign-in email — read-only here"
                  className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Admin Name</label>
                <input
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Company Name</label>
                <input
                  value={form.company_name}
                  onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">PAN No</label>
                <input
                  value={form.pan_no}
                  onChange={e => setForm(f => ({ ...f, pan_no: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Location</label>
                <input
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-critical">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowEdit(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoSelected} className="hidden" />
      {pendingPhotoFile && (
        <PhotoCropModal
          file={pendingPhotoFile}
          saving={uploadingPhoto}
          onCancel={() => setPendingPhotoFile(null)}
          onSave={handlePhotoCropped}
        />
      )}

      {showPassword && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowPassword(false)}>
          <form
            onSubmit={handleChangePassword}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
          >
            {passwordSuccess ? (
              <>
                <h3 className="mb-1 text-lg font-semibold text-ink">Password changed</h3>
                <p className="mb-4 text-sm text-slate-500">Your password has been updated. Use it next time you sign in.</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowPassword(false)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="mb-1 text-lg font-semibold text-ink">Change Password</h3>
                <p className="mb-4 text-xs text-slate-500">Sets a new password for your own login — you&apos;ll stay signed in.</p>
                <label className="mb-1 block text-xs font-medium text-slate-600">New password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoFocus
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                <label className="mb-1 block text-xs font-medium text-slate-600">Confirm new password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
                {passwordError && <p className="mb-3 text-sm text-critical">{passwordError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPassword(false)}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changingPassword}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
                  >
                    {changingPassword ? 'Changing…' : 'Change password'}
                  </button>
                </div>
              </>
            )}
          </form>
        </div>
      )}
    </>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="8" cy="15" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m10.8 12.2 8-8M15.5 3.5l2 2M18.5 6.5l2 2" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function SignOutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6" />
    </svg>
  );
}

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path strokeLinecap="round" d="M8 7h1M12 7h1M16 7h1M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1" />
      <path d="M10 21v-4h4v4" />
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function CalendarDotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
