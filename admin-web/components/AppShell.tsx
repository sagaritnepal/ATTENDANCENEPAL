'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ready' | 'unauthorized'>('loading');
  const [adminName, setAdminName] = useState('Admin');

  useEffect(() => {
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

  if (status === 'loading') {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }
  if (status === 'unauthorized') {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center text-slate-500">
        This login isn&apos;t linked to an admin profile. Ask an existing admin to run:
        <code className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">
          insert into profiles (id, role) values (auth.uid, &apos;admin&apos;)
        </code>
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
