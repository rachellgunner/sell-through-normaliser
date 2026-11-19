import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { cellToString } from '../lib/rawSheet'
import { parseMonthAbbreviation, utcDate, weekEndingFromSaturdayWeekStart, deriveDateFields } from '../lib/dateUtils'
import { parseCurrencyToNumber, parseIntegerUnits, roundToPence } from '../lib/currency'

const LABEL = 'Next'
const LINE_SHEET = 'Line Level'
const SUMMARY_SHEET = 'Summary'

// Next's weekly brand report ("UKSkinlabs_BrandWeeklySalesRpt<date>.xlsx")
// has three tabs — Summary (brand totals), Line Level (one row per product,
// by EAN) and Low Cover (a stock list, ignored). Every tab carries
// "Week Commencing Sat 17 Oct 2026" in its top-left corner. Columns are
// prefixed "LW" (last week) for the week itself and "Cum" for running
// totals since launch; only the "LW" columns are used here.
const H_BRAND = 'Brand Name'
const H_EXTRACT_WEEK = 'Extract Week'
const H_EAN = 'EAN'
const H_DESC = 'Item Description'
const H_DESP_UNITS = 'LW Despatches TY'
const H_DESP_VALUE = 'LW Despatches Value TY'
const H_RET_UNITS = 'LW Returns TY'
const H_RET_VALUE = 'LW Returns Value TY'
const H_NETT_UNITS = 'LW Nett Sales TY'
const H_NETT_VALUE = 'LW Nett Sales Value TY'
const REQUIRED_HEADERS = [H_BRAND, H_EXTRACT_WEEK, H_EAN, H_DESC, H_DESP_UNITS, H_DESP_VALUE, H_RET_UNITS, H_RET_VALUE, H_NETT_UNITS, H_NETT_VALUE]

/** Header text varies in spacing ("LW Returns  Value TY" has a double space in real files) — compare with whitespace collapsed. */
function norm(cell: unknown): string {
  return cellToString(cell).replace(/\s+/g, ' ')
}

function findHeaderRow(grid: unknown[][], required: string[]): number {
  for (let i = 0; i < grid.length; i++) {
    const cells = (grid[i] ?? []).map(norm)
    if (required.every((h) => cells.includes(h))) return i
  }
  return -1
}

/** "Week Commencing Sat 17 Oct 2026" (anywhere in the top rows) -> that Saturday as a UTC date. */
function readWeekCommencing(grid: unknown[][], where: string): Date {
  const pattern = /week commencing\s+(?:[a-z]{3,9}\s+)?(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})/i
  for (const row of grid.slice(0, 12)) {
    for (const cell of row ?? []) {
      const m = pattern.exec(norm(cell))
      if (!m) continue
      const month = parseMonthAbbreviation(m[2])
      if (month === null) continue
      const date = utcDate(Number(m[3]), month, Number(m[1]))
      if (date.getUTCDate() !== Number(m[1])) continue // overflowed day, e.g. 31 Feb
      if (date.getUTCDay() !== 6) {
        throw new RetailerFormatError(
          `${LABEL} (${where}): "${norm(cell)}" isn't a Saturday — the week convention may have changed, so the week-ending date can't be worked out safely.`,
        )
      }
      return date
    }
  }
  throw new RetailerFormatError(`${LABEL} (${where}): couldn't find a "Week Commencing …" date in the top rows of the sheet.`)
}

/** -39 -> "-£39.00" (for error messages). */
function gbp(v: number): string {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toFixed(2)}`
}

function number(raw: string, what: string, where: string): number {
  if (raw === '') return 0 // blank means zero in this report
  const v = parseCurrencyToNumber(raw)
  if (v === null) throw new RetailerFormatError(`${where}: expected a number for ${what}, got "${raw}"`)
  return v
}

function wholeNumber(raw: string, what: string, where: string): number {
  if (raw === '') return 0
  const v = parseIntegerUnits(raw)
  if (v === null) throw new RetailerFormatError(`${where}: expected a whole number for ${what}, got "${raw}"`)
  return v
}

/**
 * Next's trading year starts on a Saturday near the end of January
 * (W202638 = week commencing Sat 17 Oct 2026, so week 1 began Sat 31 Jan
 * 2026). Back-calculating week 1 from the "Extract Week" code and the
 * week-commencing date must land in late January / early February of that
 * year; anything else means the code and the date disagree (wrong file,
 * edited header, different calendar). Deliberately loose (24 Jan–7 Feb):
 * the exact start-of-year rule isn't confirmed, and a false alarm would
 * block a legitimate load.
 */
function checkExtractWeek(extractWeek: string, commencing: Date): void {
  const m = /^W(\d{4})(\d{2})$/.exec(extractWeek)
  if (!m) throw new RetailerFormatError(`${LABEL}: expected "Extract Week" like W202638, got "${extractWeek}".`)
  const year = Number(m[1])
  const week = Number(m[2])
  const week1 = new Date(commencing.getTime() - (week - 1) * 7 * 86400000)
  const earliest = utcDate(year, 0, 24)
  const latest = utcDate(year, 1, 7)
  if (week1 < earliest || week1 > latest) {
    throw new RetailerFormatError(
      `${LABEL}: "Extract Week" ${extractWeek} doesn't line up with "Week Commencing" ${commencing.toISOString().slice(0, 10)} ` +
        `(that would put week 1 of ${year} on ${week1.toISOString().slice(0, 10)}, not in late January) — the file's week labels disagree.`,
    )
  }
}

/** Compare the Line Level totals with the Summary tab's brand total ("All Sales" row), if the tab is there. */
function checkAgainstSummary(summary: unknown[][] | undefined, totals: { units: number; value: number }): void {
  if (!summary) return
  const headerIdx = findHeaderRow(summary, ['Brand Total', H_NETT_UNITS, H_NETT_VALUE])
  if (headerIdx === -1) {
    throw new RetailerFormatError(`${LABEL}: the "${SUMMARY_SHEET}" tab doesn't have the "Brand Total" / "${H_NETT_UNITS}" headers this check expects — the report layout may have changed.`)
  }
  const header = summary[headerIdx].map(norm)
  const fpiCol = header.indexOf('Full Price Indicator')
  const unitsCol = header.indexOf(H_NETT_UNITS)
  const valueCol = header.indexOf(H_NETT_VALUE)
  const row = summary.slice(headerIdx + 1).find((r) => fpiCol !== -1 && norm(r?.[fpiCol]) === 'All Sales')
  if (!row) {
    throw new RetailerFormatError(`${LABEL}: couldn't find the "All Sales" brand-total row on the "${SUMMARY_SHEET}" tab — the report layout may have changed.`)
  }
  const summaryUnits = wholeNumber(cellToString(row[unitsCol]), `Summary ${H_NETT_UNITS}`, `${LABEL} Summary`)
  const summaryValue = number(cellToString(row[valueCol]), `Summary ${H_NETT_VALUE}`, `${LABEL} Summary`)
  if (summaryUnits !== totals.units || Math.abs(summaryValue - totals.value) > 0.05) {
    throw new RetailerFormatError(
      `${LABEL}: Line Level adds up to ${totals.units} units / £${totals.value.toFixed(2)} nett, but the Summary tab's brand total says ${summaryUnits} / £${summaryValue.toFixed(2)} — the report layout may have changed.`,
    )
  }
}

export const next: RetailerParser = {
  key: 'next',
  label: LABEL,
  skuLevel: true,

  detect(sheet: RawSheet): number {
    let score = 0
    const grid = sheet.sheets?.[LINE_SHEET]
    if (grid && findHeaderRow(grid, REQUIRED_HEADERS) !== -1) score += 0.6
    if (sheet.fileName.toLowerCase().includes('brandweeklysalesrpt')) score += 0.4
    return Math.min(score, 1)
  },

  parse(sheet: RawSheet): ParsedRow[] {
    if (!sheet.sheets) {
      throw new RetailerFormatError(`Expected a multi-tab ${LABEL} workbook (.xlsx) with a "${LINE_SHEET}" tab — got a single-sheet/CSV file.`)
    }
    const grid = sheet.sheets[LINE_SHEET]
    if (!grid) {
      throw new RetailerFormatError(`Couldn't find a "${LINE_SHEET}" tab in this workbook. Tabs found: ${Object.keys(sheet.sheets).join(', ')}`)
    }
    const headerRowIndex = findHeaderRow(grid, REQUIRED_HEADERS)
    if (headerRowIndex === -1) {
      throw new RetailerFormatError(
        `"${LINE_SHEET}" doesn't look like this ${LABEL} report — couldn't find a header row containing ${REQUIRED_HEADERS.map((h) => `"${h}"`).join(', ')}.`,
      )
    }
    const header = grid[headerRowIndex].map(norm)
    const col = (name: string) => header.indexOf(name)
    const c = {
      brand: col(H_BRAND),
      extract: col(H_EXTRACT_WEEK),
      ean: col(H_EAN),
      desc: col(H_DESC),
      despUnits: col(H_DESP_UNITS),
      despValue: col(H_DESP_VALUE),
      retUnits: col(H_RET_UNITS),
      retValue: col(H_RET_VALUE),
      nettUnits: col(H_NETT_UNITS),
      nettValue: col(H_NETT_VALUE),
    }

    const commencing = readWeekCommencing(grid, LINE_SHEET)
    // The Summary tab states the same week — a mismatch means the tabs came from different reports.
    if (sheet.sheets[SUMMARY_SHEET]) {
      const summaryWeek = readWeekCommencing(sheet.sheets[SUMMARY_SHEET], SUMMARY_SHEET)
      if (summaryWeek.getTime() !== commencing.getTime()) {
        throw new RetailerFormatError(
          `${LABEL}: the "${LINE_SHEET}" tab says week commencing ${commencing.toISOString().slice(0, 10)} but the "${SUMMARY_SHEET}" tab says ${summaryWeek.toISOString().slice(0, 10)}.`,
        )
      }
    }
    const weekEnding = weekEndingFromSaturdayWeekStart(commencing)
    const dateFields = deriveDateFields(weekEnding)

    const normalized: ParsedRow[] = []
    const seenEans = new Set<string>()
    let extractWeek: string | null = null
    const totals = { units: 0, value: 0 }

    grid.slice(headerRowIndex + 1).forEach((row, i) => {
      const rowNumber = headerRowIndex + 2 + i
      if (!row || row.every((cell) => cellToString(cell) === '')) return // blank row
      const where = `${LABEL} "${LINE_SHEET}" row ${rowNumber}`

      const brandCell = cellToString(row[c.brand])
      if (!brandCell) throw new RetailerFormatError(`${where}: no brand name — expected one product per row.`)

      const ean = cellToString(row[c.ean])
      if (!/^\d{8,14}$/.test(ean)) throw new RetailerFormatError(`${where}: expected a numeric EAN, got "${ean}".`)
      if (seenEans.has(ean)) throw new RetailerFormatError(`${where}: EAN ${ean} appears more than once in this report.`)
      seenEans.add(ean)

      const description = norm(row[c.desc])
      if (!description) throw new RetailerFormatError(`${where} (EAN ${ean}): no item description.`)

      const rowExtract = cellToString(row[c.extract])
      if (extractWeek === null) extractWeek = rowExtract
      else if (rowExtract !== extractWeek) {
        throw new RetailerFormatError(`${where}: "Extract Week" is ${rowExtract}, but earlier rows say ${extractWeek} — expected one week per report.`)
      }

      const despUnits = wholeNumber(cellToString(row[c.despUnits]), H_DESP_UNITS, where)
      const despValue = number(cellToString(row[c.despValue]), H_DESP_VALUE, where)
      const retUnits = wholeNumber(cellToString(row[c.retUnits]), H_RET_UNITS, where)
      const retValue = number(cellToString(row[c.retValue]), H_RET_VALUE, where)
      const units = wholeNumber(cellToString(row[c.nettUnits]), H_NETT_UNITS, where)
      const value = number(cellToString(row[c.nettValue]), H_NETT_VALUE, where)

      // Returns are reported as negatives, so nett = despatches + returns.
      // Catches a column shift or a changed sign convention immediately.
      if (units !== despUnits + retUnits || Math.abs(value - (despValue + retValue)) > 0.02) {
        throw new RetailerFormatError(
          `${where} (${description}): nett ${units} units / ${gbp(value)} isn't despatches ${despUnits} / ${gbp(despValue)} + returns ${retUnits} / ${gbp(retValue)} — the report layout may have changed.`,
        )
      }

      totals.units += units
      totals.value += value

      if (units === 0 && value === 0) return // no net sales that week — skip rather than emit an all-zero row

      normalized.push({
        RETAILER: LABEL,
        BRAND: brandCell.toUpperCase(),
        // Next's descriptions are truncated to ~20 characters and some repeat
        // ("UKL LIP GLOSS", "UKL BROW PENCIL", "UKL TUBING MASC" each cover
        // two shades), which would collide on ROW_KEY. The EAN is unique and
        // stable, so it goes in the title ("[code]" style, as the older
        // Sephora names used).
        PRODUCT_TITLE: `${description} [${ean}]`,
        ...dateFields,
        SALES_AMOUNT: roundToPence(value),
        SALES_UNITS: units,
        // The report has no channel/store breakdown. "Despatches" (shipped
        // orders) and the "Retail Home" group point to home delivery; confirmed
        // by the business (2026-11-19) to treat everything as online, like Boots.
        // PROVISIONAL: values look VAT-inclusive (9 × £39 shelf price = £351
        // exactly); not converted, pending Next's answer.
        CHANNEL: 'Online',
        STORE_LOCATION: 'Online',
        REGION: 'Online',
        PERIOD: 'WEEK',
      })
    })

    if (extractWeek === null) throw new RetailerFormatError(`${LABEL}: the "${LINE_SHEET}" tab has no product rows.`)
    checkExtractWeek(extractWeek, commencing)
    checkAgainstSummary(sheet.sheets[SUMMARY_SHEET], { units: totals.units, value: roundToPence(totals.value) })

    return normalized
  },
}
