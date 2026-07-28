'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import ConfigWarning from './ConfigWarning';

const TABS = [
  { href: '/checkin', label: 'Check In', icon: CheckInIcon },
  { href: '/my-attendance', label: 'History', icon: HistoryIcon },
  { href: '/my-calendar', label: 'Calendar', icon: CalendarTabIcon },
  { href: '/my-leave', label: 'Leave', icon: LeaveIcon },
  { href: '/my-corrections', label: 'Fix Punch', icon: FixIcon },
];

export default function EmployeeShell({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<'loading' | 'ready' | 'redirecting'>('loading');
  const [name, setName] = useState('Employee');
  const [linked, setLinked] = useState(true);

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
      if (!profile || profile.role !== 'employee') {
        // Admin/HR accounts have their own dashboard — this shell is
        // employee-only.
        setStatus('redirecting');
        router.replace('/');
        return;
      }
      if (!profile.employee_id) {
        setLinked(false);
        setName(data.session.user.email?.split('@')[0] ?? 'Employee');
        setStatus('ready');
        return;
      }
      const { data: emp } = await supabase.from('employees').select('name').eq('id', profile.employee_id).single();
      if (!active) return;
      setName(emp?.name ?? 'Employee');
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
        <div>
          <div className="text-xs text-slate-400">{title}</div>
          <div className="text-base font-semibold text-ink">{name}</div>
        </div>
        <button
          onClick={handleSignOut}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          Sign out
        </button>
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
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs ${
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
function HistoryIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
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
function LeaveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h5l2-3h4l2 3h5M4 12l1.5 7h13L20 12" />
    </svg>
  );
}
function FixIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20a8 8 0 1 0-6.93-4M4 15v5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5" />
    </svg>
  );
}
