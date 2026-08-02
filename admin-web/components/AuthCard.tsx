export default function AuthCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="Attendance Nepal" className="mb-3 h-64 w-64 shrink-0" />
          <span className="text-xl font-bold text-ink">Attendance Nepal</span>
          {title && <span className="mt-1 text-sm text-slate-500">{title}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}
