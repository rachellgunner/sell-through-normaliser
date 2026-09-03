import { getISOWeek, getISOWeekYear } from 'date-fns'

// All dates in this module are handled as UTC midnight to avoid any
// timezone-shift bugs when doing day-arithmetic (adding/subtracting days).

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function utcDate(year: number, monthIndex0: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex0, day))
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

const MONTH_ABBR_TO_INDEX0: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

/** "Aug" / "August" / "Sept" (matched on the first 3 letters) -> 7 (0-based month index). Returns null if unrecognized. */
export function parseMonthAbbreviation(text: string): number | null {
  const key3 = text.trim().toLowerCase().slice(0, 3)
  return MONTH_ABBR_TO_INDEX0[key3] ?? null
}

/** Last day of the given month (e.g. lastDayOfMonth(2026, 7) -> 31 Aug 2026). Used as WEEK_ENDING for month-grain retailers. */
export function lastDayOfMonth(year: number, monthIndex0: number): Date {
  return utcDate(year, monthIndex0 + 1, 0)
}

/** Parse a DD/MM/YYYY string into a UTC-midnight Date. Throws if malformed. */
export function parseDDMMYYYY(input: string): Date {
  const trimmed = input.trim()
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
  if (!match) {
    throw new Error(`Expected a DD/MM/YYYY date, got "${input}"`)
  }
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = utcDate(year, month - 1, day)
  // Reject dates that overflowed (e.g. 31/02/2026).
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`"${input}" is not a valid calendar date`)
  }
  return date
}

/** Parse a YYYY-MM-DD (ISO) string into a UTC-midnight Date. Throws if malformed. */
export function parseYYYYMMDD(input: string): Date {
  const trimmed = input.trim()
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed)
  if (!match) {
    throw new Error(`Expected a YYYY-MM-DD date, got "${input}"`)
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = utcDate(year, month - 1, day)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`"${input}" is not a valid calendar date`)
  }
  return date
}

export function formatDDMMYYYY(date: Date): string {
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`
}

/**
 * Monday of the Monday-start week containing `date`.
 * getUTCDay(): 0=Sun..6=Sat.
 */
export function mondayOfWeek(date: Date): Date {
  const dayOfWeek = date.getUTCDay()
  const daysSinceMonday = (dayOfWeek + 6) % 7
  return addDays(date, -daysSinceMonday)
}

/** Sunday that closes the Monday-start week containing `date`. */
export function weekEndingSunday(date: Date): Date {
  return addDays(mondayOfWeek(date), 6)
}

/** Standard ISO-8601 calendar year+week (Monday-start), e.g. "2026-16". */
export function calendarYYYYWW(weekEnding: Date): string {
  return `${getISOWeekYear(weekEnding)}-${pad2(getISOWeek(weekEnding))}`
}

/** Calendar year+month of WEEK_ENDING, e.g. "2026-04". */
export function calendarYYYYMM(weekEnding: Date): string {
  return `${weekEnding.getUTCFullYear()}-${pad2(weekEnding.getUTCMonth() + 1)}`
}

/**
 * UKLASH financial year: April-March, labeled by the calendar year it ends in.
 * Jan-Mar -> FY = calendar year. Apr-Dec -> FY = calendar year + 1.
 */
export function financialYear(weekEnding: Date): number {
  const month = weekEnding.getUTCMonth() + 1 // 1-12
  const calendarYear = weekEnding.getUTCFullYear()
  return month <= 3 ? calendarYear : calendarYear + 1
}

/** Financial month: April=01 ... March=12. */
export function financialMonth(weekEnding: Date): number {
  const month = weekEnding.getUTCMonth() + 1 // 1-12
  return ((month - 4 + 12) % 12) + 1
}

export function financialYYYYMM(weekEnding: Date): string {
  return `${financialYear(weekEnding)}-${pad2(financialMonth(weekEnding))}`
}

/**
 * Financial week number: plain Monday-start week count from the start of
 * the financial year, where week 1 is the Mon-Sun week containing April 1.
 * (Confirmed with the business as the convention to use — not a 4-4-5
 * retail calendar. Revisit here if that ever changes.)
 */
export function financialWeek(weekEnding: Date): number {
  const fyYear = financialYear(weekEnding)
  const fyStartMonday = mondayOfWeek(utcDate(fyYear - 1, 3, 1)) // April = monthIndex 3
  const thisMonday = mondayOfWeek(weekEnding)
  const diffDays = Math.round((thisMonday.getTime() - fyStartMonday.getTime()) / MS_PER_DAY)
  return Math.floor(diffDays / 7) + 1
}

export function financialYYYYWW(weekEnding: Date): string {
  return `${financialYear(weekEnding)}-${pad2(financialWeek(weekEnding))}`
}

/**
 * PROVISIONAL — pending a final cross-retailer decision (see project notes).
 * Some retailers (confirmed so far: John Lewis) report weeks as Sunday-Saturday
 * rather than our Monday-Sunday convention, with no daily-level data to
 * convert exactly. Shifting the reported Sunday start-date forward by 7 days
 * gives WEEK_ENDING as the following Sunday, which has 6/7 days' overlap with
 * our Monday-start week (vs. 1/7 if used as-is) — the better of the two
 * simple options, but still an approximation. Revisit this once all
 * retailers with non-Monday-start weeks are known, in case a single
 * unified rule (rather than a per-retailer one) is wanted instead.
 */
export function weekEndingFromSundayWeekStart(sundayStart: Date): Date {
  return addDays(sundayStart, 7)
}

/**
 * PROVISIONAL — same rationale as weekEndingFromSundayWeekStart above,
 * for retailers (confirmed so far: Boots) that report the closing
 * Saturday of a Sunday-Saturday week instead of the opening Sunday.
 * Shifting forward by 1 day gives WEEK_ENDING as the following Sunday —
 * mathematically the same conversion as the Sunday-start case (a
 * Saturday close is always 6 days after that week's Sunday start, and
 * 6 + 1 = 7), just expressed from the other end of the week.
 */
export function weekEndingFromSaturdayClose(saturdayClose: Date): Date {
  return addDays(saturdayClose, 1)
}

/**
 * Inverse of calendarYYYYWW: given an ISO-8601 year+week number (Monday-start,
 * week 1 = the week containing the year's first Thursday), return the Sunday
 * that closes that week — i.e. the WEEK_ENDING for a retailer that labels
 * rows by ISO year+week rather than an actual date (confirmed so far:
 * Sephora's "Year Week" column, e.g. "2026 01").
 */
export function weekEndingFromIsoYearWeek(isoYear: number, isoWeek: number): Date {
  const jan4 = utcDate(isoYear, 0, 4) // Jan 4 is always in ISO week 1
  const jan4DayOfWeek = jan4.getUTCDay() || 7 // Mon=1..Sun=7
  const week1Monday = addDays(jan4, 1 - jan4DayOfWeek)
  return addDays(week1Monday, (isoWeek - 1) * 7 + 6)
}

/** Convenience: derive every date-based schema field from one WEEK_ENDING date. */
export function deriveDateFields(weekEnding: Date) {
  return {
    WEEK_ENDING: formatDDMMYYYY(weekEnding),
    CALENDAR_YYYY_WW: calendarYYYYWW(weekEnding),
    CALENDAR_YYYY_MM: calendarYYYYMM(weekEnding),
    FINANCIAL_YYYY_WW: financialYYYYWW(weekEnding),
    FINANCIAL_YYYY_MM: financialYYYYMM(weekEnding),
  }
}
