export default function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-bold text-white">X</div>
          <span className="text-lg font-semibold text-ink">
            Attend<span className="text-accent">X</span> {title}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
