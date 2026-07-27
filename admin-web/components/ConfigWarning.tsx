export default function ConfigWarning() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
      <h1 className="text-lg font-semibold text-ink">Supabase isn&apos;t configured</h1>
      <p className="max-w-md text-sm text-slate-500">
        <code className="rounded bg-slate-100 px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-slate-100 px-1.5 py-0.5">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> are missing. Add them in your
        deployment&apos;s environment variables (Vercel → Project → Settings → Environment Variables) and redeploy.
      </p>
    </div>
  );
}
