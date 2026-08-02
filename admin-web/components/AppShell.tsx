'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import ConfigWarning from './ConfigWarning';

type Role = 'admin' | 'hr';

type SearchProps = { value: string; onChange: (value: string) => void; placeholder?: string; suggestions?: string[] };

export default function AppShell({
  title,
  children,
  search,
}: {
  title: string;
  children: React.ReactNode;
  search?: SearchProps;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ready' | 'redirecting'>('loading');
  const [role, setRole] = useState<Role>('admin');
  const [adminName, setAdminName] = useState('Admin');
  const [drawerOpen, setDrawerOpen] = useState(false);

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
      if (profile?.role === 'employee' || !profile) {
        // Employees get their own mobile-first pages, never this dashboard.
        setStatus('redirecting');
        router.replace('/checkin');
        return;
      }
      setRole(profile.role as Role);
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
  if (status !== 'ready') {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar role={role} adminName={adminName} drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
      <div className="flex flex-1 flex-col overflow-y-auto">
        <TopBar title={title} onOpenMenu={() => setDrawerOpen(true)} search={search} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
