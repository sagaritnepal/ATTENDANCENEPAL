/** Plain-text (non-badge) rendering of a day's attendance status — used by
 * the dense mobile tables (Attendance Report, Payroll detail) where a full
 * Badge pill doesn't fit a narrow column. Mirrors statusBadge()'s logic in
 * each of those pages so the two views never disagree. */
export default function StatusText({ checkIn, status }: { checkIn: string | null; status: string }) {
  if (checkIn) return <span className="text-good-text">Present</span>;
  if (status === 'Upcoming') return <span className="text-slate-400">Upcoming</span>;
  return <span className="text-critical-text">Absent</span>;
}
