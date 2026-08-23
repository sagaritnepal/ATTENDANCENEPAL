import NepaliDate from 'nepali-date-converter';

export type PredefinedHoliday = {
  name: string;
  /** AD date, 'YYYY-MM-DD' — first day of the holiday. */
  start: string;
  /** AD date, 'YYYY-MM-DD' — last day of the holiday (same as start if it's a single day). */
  end: string;
};

/** BS year -> that year's Government of Nepal public holiday list, sourced
 * from hamropatro.com's official Nepali public holiday calendar for that
 * specific year. Multi-day festival closures (Dashain, Tihar) are kept as a
 * single ranged entry — start/end are both AD 'YYYY-MM-DD', equal for a
 * single-day holiday — so picking one from the New Holiday form's Name
 * field can fill in its whole duration at once instead of just day one.
 *
 * Nepal's festival dates are lunar/panchang-based and shift every BS year,
 * and the government doesn't gazette next year's list until shortly before
 * that year actually starts — so this can only ever hold years that have
 * already been published, never be computed or guessed ahead of time. Add a
 * `[year]: [...]` entry here (same shape, same hamropatro source, same
 * process used for 2083) once a new BS year's list is out; nothing else in
 * this file needs to change — currentBsYear()/upcomingHolidays() below
 * already pick whichever year's data matches today's date automatically,
 * and correctly show nothing (not stale data) for a year not added yet. */
export const NEPAL_PUBLIC_HOLIDAYS_BY_BS_YEAR: Record<number, PredefinedHoliday[]> = {
  2083: [
    { name: 'Nepali New Year / Biska Jatra', start: '2026-04-14', end: '2026-04-14' },
    { name: 'International Labour Day / Buddha Jayanti', start: '2026-05-01', end: '2026-05-01' },
    { name: 'Bakar Eid (Eid al-Adha)', start: '2026-05-28', end: '2026-05-28' },
    { name: 'Republic Day / International Everest Day', start: '2026-05-29', end: '2026-05-29' },
    { name: 'Bhoto Jatra / Kumar Sasthi', start: '2026-06-20', end: '2026-06-20' },
    { name: 'Janai Poornima / Raksha Bandhan', start: '2026-08-28', end: '2026-08-28' },
    { name: 'Gaijatra', start: '2026-08-29', end: '2026-08-29' },
    { name: 'Shree Krishna Janmashtami', start: '2026-09-04', end: '2026-09-04' },
    { name: 'Haritalika Teej / Ganesh Chaturthi', start: '2026-09-14', end: '2026-09-14' },
    { name: 'Constitution Day', start: '2026-09-19', end: '2026-09-19' },
    { name: 'Indra Jatra', start: '2026-09-25', end: '2026-09-25' },
    { name: 'Jitiya Parva', start: '2026-10-04', end: '2026-10-04' },
    { name: 'Ghatasthapana', start: '2026-10-11', end: '2026-10-11' },
    { name: 'Dashain (Fulpati – Duwadashi)', start: '2026-10-17', end: '2026-10-23' },
    { name: 'Tihar (Laxmi Pooja – Bhai Tika)', start: '2026-11-08', end: '2026-11-12' },
    { name: 'Chhath Parva', start: '2026-11-15', end: '2026-11-15' },
    { name: 'Guru Nanak Jayanti', start: '2026-11-24', end: '2026-11-24' },
    { name: 'International Day of Disabled Persons', start: '2026-12-03', end: '2026-12-03' },
    { name: 'Udhauli Parva / Yomari Punhi', start: '2026-12-24', end: '2026-12-24' },
    { name: 'Christmas Day', start: '2026-12-25', end: '2026-12-25' },
    { name: 'Tamu Lhosar', start: '2026-12-30', end: '2026-12-30' },
    { name: 'Prithvi Jayanti', start: '2027-01-11', end: '2027-01-11' },
    { name: 'Maghe Sankranti', start: '2027-01-15', end: '2027-01-15' },
    { name: "Martyrs' Day (Shahid Diwas)", start: '2027-01-30', end: '2027-01-30' },
    { name: 'Sonam Lhosar', start: '2027-02-07', end: '2027-02-07' },
    { name: 'Saraswati Pooja / Basanta Panchami', start: '2027-02-11', end: '2027-02-11' },
    { name: 'National Democracy Day', start: '2027-02-19', end: '2027-02-19' },
    { name: 'Maha Shivaratri', start: '2027-03-06', end: '2027-03-06' },
    { name: "International Women's Day", start: '2027-03-08', end: '2027-03-08' },
    { name: 'Gyalpo Lhosar', start: '2027-03-09', end: '2027-03-09' },
    { name: 'Fagu Poornima / Holi (Hills)', start: '2027-03-21', end: '2027-03-21' },
    { name: 'Fagu Poornima / Holi (Terai)', start: '2027-03-22', end: '2027-03-22' },
    { name: 'Ghode Jatra', start: '2027-04-06', end: '2027-04-06' },
  ],
};

/** Every date 'YYYY-MM-DD' from start to end inclusive. */
export function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** The BS year an AD date ('YYYY-MM-DD') falls in. */
function bsYearOf(adIso: string): number {
  const [y, m, d] = adIso.split('-').map(Number);
  return NepaliDate.fromAD(new Date(y, m - 1, d)).getYear();
}

/** Holidays from whichever BS year `todayIso` (an AD 'YYYY-MM-DD') falls in,
 * filtered to ones whose last day hasn't passed yet (today's own multi-day
 * holiday still counts as "upcoming" even if it started a day or two ago),
 * sorted soonest-first — what the New Holiday form's Name suggestions
 * should show. Once the BS year rolls over past whatever's listed above,
 * this returns [] for that year instead of quietly falling back to the old
 * year's now-irrelevant list. */
export function upcomingHolidays(todayIso: string): PredefinedHoliday[] {
  const holidays = NEPAL_PUBLIC_HOLIDAYS_BY_BS_YEAR[bsYearOf(todayIso)] ?? [];
  return holidays.filter(h => h.end >= todayIso).sort((a, b) => a.start.localeCompare(b.start));
}
