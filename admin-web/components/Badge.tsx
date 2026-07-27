const TONES = {
  good: 'bg-good-bg text-good-text',
  warning: 'bg-warning-bg text-warning-text',
  critical: 'bg-critical-bg text-critical-text',
  info: 'bg-info-bg text-info-text',
  neutral: 'bg-slate-100 text-slate-600',
} as const;

export default function Badge({ tone, children }: { tone: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${TONES[tone]}`}>
      {children}
    </span>
  );
}
