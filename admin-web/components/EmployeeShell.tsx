'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import ConfigWarning from './ConfigWarning';
import CalendarSystemSwitch from './CalendarSystemSwitch';

const TABS = [
  { href: '/checkin', label: 'Check In/Out', icon: CheckInIcon },
  { href: '/my-calendar', label: 'Calendar', icon: CalendarTabIcon },
  { href: '/my-payroll', label: 'Payroll', icon: PayrollTabIcon },
  { href: '/my-tasks', label: 'Tasks', icon: TaskTabIcon },
  { href: '/my-profile', label: 'Profile', icon: ProfileTabIcon },
];

export default function EmployeeShell({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<'loading' | 'ready' | 'redirecting'>('loading');
  const [name, setName] = useState('Employee');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [linked, setLinked] = useState(true);
  const [isHr, setIsHr] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAccountMenu) return;
    function handlePointerDown(e: MouseEvent) {
      if (accountMenuRef.current?.contains(e.target as Node)) return;
      setShowAccountMenu(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [showAccountMenu]);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      if (!data.session) {
        router.replace('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, employee_id')
        .eq('id', data.session.user.id)
        .single();
      if (!active) return;
      if (!profile || (profile.role !== 'employee' && profile.role !== 'hr')) {
        // Admin has its own dashboard only — HR is also staff, so it gets
        // both this shell (their own check-in) and the admin console.
        setStatus('redirecting');
        router.replace('/');
        return;
      }
      setIsHr(profile.role === 'hr');
      if (!profile.employee_id) {
        setLinked(false);
        setName(data.session.user.email?.split('@')[0] ?? 'Employee');
        setStatus('ready');
        return;
      }
      const { data: emp } = await supabase
        .from('employees')
        .select('name, profile_photo_url')
        .eq('id', profile.employee_id)
        .single();
      if (!active) return;
      setName(emp?.name ?? 'Employee');
      setPhotoUrl(emp?.profile_photo_url ?? null);
      setStatus('ready');
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (!supabaseConfigured) return <ConfigWarning />;
  if (status !== 'ready') {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4">
        <CalendarSystemSwitch />
        <div className="flex items-center gap-3">
          {isHr && (
            <Link
              href="/"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Admin Dashboard
            </Link>
          )}
          <div ref={accountMenuRef} className="relative flex items-center gap-2">
            <button
              onClick={() => setShowAccountMenu(v => !v)}
              title="Account"
              className="text-base font-semibold text-ink"
            >
              {name}
            </button>
            <button
              onClick={() => setShowAccountMenu(v => !v)}
              title="Account"
              className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/10 text-sm font-semibold text-accent"
            >
              {photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl} alt={name} className="h-full w-full object-cover" />
              ) : (
                name.slice(0, 1)
              )}
            </button>
            {showAccountMenu && (
              <div className="absolute right-0 top-full z-20 mt-2 w-32 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                <button
                  onClick={handleSignOut}
                  className="w-full px-3 py-2 text-left text-sm font-medium text-critical hover:bg-slate-50"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!linked && (
        <div className="mx-4 mt-4 rounded-lg bg-warning-bg px-4 py-3 text-sm text-warning-text">
          Your account isn&apos;t linked to an employee record yet. Ask an admin or HR to fix this from the Employees
          page before you can check in.
        </div>
      )}

      <main className="flex-1 p-4 pb-24">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 flex border-t border-slate-200 bg-white">
        {TABS.map(tab => {
          const active = pathname === tab.href;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-center text-[11px] leading-tight ${
                active ? 'text-accent' : 'text-slate-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

type IconProps = { className?: string };
function CheckInIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.5 2.5 2.5 5-5" />
    </svg>
  );
}
function CalendarTabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function PayrollTabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path strokeLinecap="round" d="M3 10h18" />
      <circle cx="12" cy="14.5" r="2.25" />
    </svg>
  );
}
function TaskTabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}
function ProfileTabIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
    </svg>
  );
}
