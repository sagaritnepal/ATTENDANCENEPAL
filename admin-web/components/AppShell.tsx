'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ConfigWarning from './ConfigWarning';

export default function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized'>('loading');
  const [adminName, setAdminName] = useState('Admin');

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
        .select('role')
        .eq('id', data.session.user.id)
        .single();
      if (!active) return;
      if (profile?.role !== 'admin') {
        setStatus('unauthorized');
        return;
      }
      setAdminName(data.session.user.email?.split('@')[0] ?? 'Admin');
      setStatus('ready');
    });
    return () => {
      active = false;
    };
  }, [router]);

  if (!supabaseConfigured) {
    return <ConfigWarning />;
  }
  if (status === 'loading') {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }
  if (status === 'unauthorized') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center text-slate-500">
        <p className="max-w-md">
          This account has employee-level access, not admin. This dashboard is admin-only — use the AttendX mobile app
          for check-in instead. Ask an existing admin to upgrade your role with:
        </p>
        <code className="rounded bg-slate-100 px-2 py-1 text-xs">
          update profiles set role = &apos;admin&apos; where id = &apos;&lt;your-auth-uuid&gt;&apos;;
        </code>
        <button
          onClick={() => supabase.auth.signOut().then(() => router.replace('/login'))}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar adminName={adminName} />
      <div className="flex flex-1 flex-col overflow-y-auto">
        <TopBar title={title} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
