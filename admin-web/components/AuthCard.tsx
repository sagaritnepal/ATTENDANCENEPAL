export default function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="Attendance Nepal" className="h-8 w-8 shrink-0" />
          <span className="text-lg font-semibold text-ink">Attendance Nepal — {title}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
