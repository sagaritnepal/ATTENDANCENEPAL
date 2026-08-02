'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';

type Account = { id: string; email: string; role: 'admin' | 'hr' | 'employee'; employeeName: string | null };

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(length = 10) {
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)];
  return out;
}

export default function TeamPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [resetAccount, setResetAccount] = useState<Account | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);

  async function reload() {
    setError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setError('Your session expired — please sign in again.');
      setLoading(false);
      return;
    }
    const res = await fetch('/api/accounts', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(body.error ?? 'Could not load accounts.');
      return;
    }
    setAccounts(body.accounts ?? []);
  }
  useEffect(() => {
    reload();
  }, []);

  function openResetModal(acc: Account) {
    setResetPassword(generatePassword());
    setResetError(null);
    setResetResult(null);
    setResetAccount(acc);
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetAccount) return;
    setResetting(true);
    setResetError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setResetting(false);
      setResetError('Your session expired — please sign in again.');
      return;
    }
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId: resetAccount.id, password: resetPassword }),
    });
    const body = await res.json().catch(() => ({}));
    setResetting(false);
    if (!res.ok) {
      setResetError(body.error ?? 'Could not reset the password.');
      return;
    }
    setResetResult(resetPassword);
  }

  return (
    <AppShell title="Team Accounts">
      <p className="mb-5 text-sm text-slate-500">
        Every login account and its role. Employee logins can also be reset from the Employees page — this covers
        admin/HR accounts, which aren&apos;t tied to an employee record.
      </p>

      {error && <p className="mb-4 text-sm text-critical">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Linked employee</th>
              <th className="px-5 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(acc => (
              <tr key={acc.id} className="border-b border-slate-100 last:border-0">
                <td className="px-5 py-3 text-ink">{acc.email || '—'}</td>
                <td className="px-5 py-3">
                  <Badge tone={acc.role === 'admin' ? 'good' : acc.role === 'hr' ? 'info' : 'neutral'}>{acc.role}</Badge>
                </td>
                <td className="px-5 py-3 text-slate-600">{acc.employeeName ?? '—'}</td>
                <td className="px-5 py-3">
                  <button onClick={() => openResetModal(acc)} className="text-xs font-medium text-accent hover:underline">
                    Reset password
                  </button>
                </td>
              </tr>
            ))}
            {!loading && accounts.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                  No accounts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {resetAccount && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            {resetResult ? (
              <>
                <h3 className="mb-1 text-lg font-semibold text-ink">Password reset</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Share this with {resetAccount.email}. Their old password no longer works. This won&apos;t be shown
                  again.
                </p>
                <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <div>
                    <span className="text-xs uppercase text-slate-400">New password</span>
                    <div className="font-mono font-medium text-ink">{resetResult}</div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setResetAccount(null)}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleReset}>
                <h3 className="mb-1 text-lg font-semibold text-ink">Reset Password</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Sets a new password for {resetAccount.email}&apos;s login ({resetAccount.role}). Their current
                  password stops working immediately.
                </p>
                <label className="mb-1 block text-xs font-medium text-slate-600">New password</label>
                <div className="mb-3 flex gap-2">
                  <input
                    required
                    minLength={8}
                    value={resetPassword}
                    onChange={e => setResetPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <button
                    type="button"
                    onClick={() => setResetPassword(generatePassword())}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Regenerate
                  </button>
                </div>
                {resetError && <p className="mb-3 text-sm text-critical">{resetError}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setResetAccount(null)}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={resetting}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
                  >
                    {resetting ? 'Resetting…' : 'Reset password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
