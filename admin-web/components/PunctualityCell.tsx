import type { ReactNode } from 'react';
import { formatHoursMinutes } from '@/lib/shift';

type Props = {
  /** Check-in after shift start. */
  lateMinutes: number;
  /** Check-in before shift start. */
  earlyArrivalMinutes: number;
  /** Check-out before shift end. */
  earlyMinutes: number;
  /** Check-out after shift end (overlaps overtime). */
  lateDepartureMinutes: number;
  className?: string;
};

/** The four punch-vs-shift deltas for one day (or a period total), stacked.
 * Used by the Attendance Report and the per-employee payroll breakdown so
 * both read the same way. */
export default function PunctualityCell({
  lateMinutes,
  earlyArrivalMinutes,
  earlyMinutes,
  lateDepartureMinutes,
  className,
}: Props) {
  const parts: ReactNode[] = [];
  if (lateMinutes > 0)
    parts.push(
      <span key="li" title="Late check-in" className="font-medium text-warning-text print:text-ink">
        Late in {formatHoursMinutes(lateMinutes)}
      </span>
    );
  if (earlyArrivalMinutes > 0)
    parts.push(
      <span key="ei" title="Early check-in" className="font-medium text-good-text print:text-ink">
        Early in {formatHoursMinutes(earlyArrivalMinutes)}
      </span>
    );
  if (earlyMinutes > 0)
    parts.push(
      <span key="eo" title="Early check-out" className="font-medium text-critical-text print:text-ink">
        Early out {formatHoursMinutes(earlyMinutes)}
      </span>
    );
  if (lateDepartureMinutes > 0)
    parts.push(
      <span key="lo" title="Late check-out" className="font-medium text-info-text print:text-ink">
        Late out {formatHoursMinutes(lateDepartureMinutes)}
      </span>
    );

  if (parts.length === 0) return <span className={`text-slate-400 print:text-ink ${className ?? ''}`}>—</span>;
  return <span className={`flex flex-col gap-0.5 leading-tight ${className ?? ''}`}>{parts}</span>;
}
