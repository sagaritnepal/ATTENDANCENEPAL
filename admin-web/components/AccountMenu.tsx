'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type ProfileForm = { full_name: string; company_name: string; pan_no: string; location: string };
const EMPTY_FORM: ProfileForm = { full_name: '', company_name: '', pan_no: '', location: '' };

type ProfileSummary = ProfileForm & { email: string; created_at: string | null };

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

  // Fetched once on mount (not on every dropdown open) — the same data
  // backs both the dropdown's info card and the Edit Profile form, so
  // opening either is instant instead of waiting on a fresh round trip.
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data: userData }) => {
      if (!active || !userData.user) return;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, company_name, pan_no, location, created_at')
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

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
            {adminName.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block max-w-[9rem] truncate text-sm font-medium text-ink">{adminName}</span>
            <span className="block text-xs text-slate-400">{role === 'admin' ? 'System Administrator' : 'HR'}</span>
          </span>
          <ChevronIcon className={`hidden h-4 w-4 shrink-0 text-slate-400 transition-transform sm:block ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center gap-3 bg-slate-50 p-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/10 text-lg font-semibold text-accent ring-2 ring-white">
                {adminName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{adminName}</div>
                <div className="text-xs text-slate-500">{role === 'admin' ? 'System Administrator' : 'HR'}</div>
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <MailIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{profile?.email || '—'}</span>
              </div>
              <div className="flex items-center gap-2">
                <BuildingIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">{profile?.company_name || 'No company set'}</span>
              </div>
              <div className="flex items-center gap-2">
                <CalendarDotIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="truncate">
                  Member since{' '}
                  {profile?.created_at
                    ? new Date(profile.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'}
                </span>
              </div>
            </div>

            <div className="border-t border-slate-100 py-1">
              <button
                onClick={openEditProfile}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-ink hover:bg-slate-50"
              >
                <EditIcon className="h-4 w-4 text-slate-400" />
                Edit Profile
              </button>
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-critical hover:bg-slate-50"
              >
                <SignOutIcon className="h-4 w-4" />
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

function CalendarDotIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
