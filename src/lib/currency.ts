/**
 * Parse a currency-ish string (raw source value, e.g. "£1,234.56" or
 * "-£12.50") into a plain number, stripping currency symbols and
 * thousands separators. Returns null if it doesn't look like a number at all.
 */
export function parseCurrencyToNumber(input: string | number): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? input : null
  }
  const cleaned = input.replace(/[£$€,\s]/g, '').trim()
  if (cleaned === '' || cleaned === '-') return null
  // Support accounting-style negatives, e.g. "(12.50)".
  const negative = /^\(.*\)$/.test(cleaned)
  const numeric = negative ? cleaned.slice(1, -1) : cleaned
  const value = Number(numeric)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

/** Round to the nearest penny, avoiding floating-point noise (e.g. 12.1 + 0.2). */
export function roundToPence(amount: number): number {
  return Math.round(amount * 100) / 100
}

/**
 * Parse a units count that may have stray currency-style formatting
 * around it (seen in a real Sephora export where every cell — including
 * units, not just money — was prefixed with a literal "$" from an Excel
 * number-format artifact, e.g. "$4" or "$16"). Returns null if it isn't
 * a whole number once symbols are stripped.
 */
export function parseIntegerUnits(input: string | number): number | null {
  const value = parseCurrencyToNumber(input)
  if (value === null || !Number.isInteger(value)) return null
  return value
}
