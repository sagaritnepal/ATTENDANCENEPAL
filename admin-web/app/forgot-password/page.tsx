'use client';

import { useState } from 'react';
import Link from 'next/link';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import AuthCard from '@/components/AuthCard';
import ConfigWarning from '@/components/ConfigWarning';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!supabaseConfigured) {
    return <ConfigWarning />;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthCard title="Reset Password">
      {sent ? (
        <p className="text-sm text-slate-600">
          If an account exists for <span className="font-medium text-ink">{email}</span>, a password reset link has been
          sent. Follow it to set a new password.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <p className="mb-4 text-sm text-slate-500">Enter your email and we&apos;ll send you a reset link.</p>
          <label className="mb-1 block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {error && <p className="mb-4 text-sm text-critical">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
          >
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-slate-600">
        <Link href="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}
