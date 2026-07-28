import NepaliDate from 'nepali-date-converter';

export type CalendarSystem = 'AD' | 'BS';

export type CalendarCell = {
  /** AD calendar date as YYYY-MM-DD — the key attendance_logs is queried by. */
  adKey: string;
  /** The day-of-month number to display, in whichever system is active. */
  displayDay: number;
  inMonth: boolean;
  isToday: boolean;
};

export type CalendarMonth = {
  label: string;
  weeks: CalendarCell[][];
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function dateKey(year: number, monthIndex0: number, day: number) {
  return `${year}-${pad(monthIndex0 + 1)}-${pad(day)}`;
}

function chunkIntoWeeks(cells: CalendarCell[]): CalendarCell[][] {
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** AD grid needs no library — plain JS Date, weekday 0=Sun same as the BS lib. */
function buildAdMonth(year: number, monthIndex: number, todayKey: string): CalendarMonth {
  const first = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const weekday = first.getDay();
  const totalCells = Math.ceil((weekday + daysInMonth) / 7) * 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, monthIndex, 1 - weekday + i);
    const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    cells.push({
      adKey: key,
      displayDay: d.getDate(),
      inMonth: d.getMonth() === monthIndex && d.getFullYear() === year,
      isToday: key === todayKey,
    });
  }
  return {
    label: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    weeks: chunkIntoWeeks(cells),
  };
}

/**
 * A fresh NepaliDate per cell (not one mutated/reused instance): setDate()
 * re-bases against whatever month the object currently holds, so reusing one
 * instance across cells that roll into adjacent months would compound.
 */
function buildBsMonth(bsYear: number, bsMonth: number, todayKey: string): CalendarMonth {
  const daysInMonth = new NepaliDate(bsYear, bsMonth + 1, 0).getDate();
  const first = new NepaliDate(bsYear, bsMonth, 1);
  const weekday = first.getDay();
  const totalCells = Math.ceil((weekday + daysInMonth) / 7) * 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const cell = new NepaliDate(bsYear, bsMonth, 1);
    cell.setDate(1 - weekday + i);
    const ad = cell.getAD();
    const key = dateKey(ad.year, ad.month, ad.date);
    cells.push({
      adKey: key,
      displayDay: cell.getDate(),
      inMonth: cell.getYear() === bsYear && cell.getMonth() === bsMonth,
      isToday: key === todayKey,
    });
  }
  return { label: first.format('MMMM YYYY'), weeks: chunkIntoWeeks(cells) };
}

function todayKey() {
  const d = new Date();
  return dateKey(d.getFullYear(), d.getMonth(), d.getDate());
}

/** anchor is always an AD (year, monthIndex) pair — the single source of
 * truth for "which month period we're looking at", independent of which
 * calendar system is currently displayed. */
export function buildMonth(system: CalendarSystem, anchorAdYear: number, anchorAdMonth: number): CalendarMonth {
  const tKey = todayKey();
  if (system === 'AD') return buildAdMonth(anchorAdYear, anchorAdMonth, tKey);
  const bs = NepaliDate.fromAD(new Date(anchorAdYear, anchorAdMonth, 1)).getBS();
  return buildBsMonth(bs.year, bs.month, tKey);
}

/** Steps the anchor by one full month in the currently displayed system,
 * then returns the new anchor back in AD terms. */
export function stepAnchor(
  system: CalendarSystem,
  anchorAdYear: number,
  anchorAdMonth: number,
  direction: 1 | -1
): { year: number; month: number } {
  if (system === 'AD') {
    const d = new Date(anchorAdYear, anchorAdMonth + direction, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }
  const bs = NepaliDate.fromAD(new Date(anchorAdYear, anchorAdMonth, 1)).getBS();
  const nextBs = new NepaliDate(bs.year, bs.month + direction, 1);
  const ad = nextBs.getAD();
  return { year: ad.year, month: ad.month };
}

export function todayAnchor(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}
