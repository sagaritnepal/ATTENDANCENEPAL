export default function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{label}</span>
        {icon && <span className="rounded-lg bg-slate-50 p-2 text-accent">{icon}</span>}
      </div>
      <div className="mt-3 text-3xl font-bold text-ink">{value}</div>
      {hint && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          <span className="h-1 w-1 rounded-full bg-accent" />
          {hint}
        </div>
      )}
    </div>
  );
}
