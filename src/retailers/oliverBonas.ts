import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { findHeaderRowIndex, cellToString } from '../lib/rawSheet'
import { deriveDateFields, lastDayOfMonth, parseMonthAbbreviation } from '../lib/dateUtils'
import { parseCurrencyToNumber, parseIntegerUnits, roundToPence } from '../lib/currency'

const LABEL = 'Oliver Bonas'
const REQUIRED_HEADERS = ['PRODUCT GROUP', 'RCODE', 'DESCRIPTION']

/** e.g. "Aug-26" -> { year: 2026, monthIndex0: 7 }. Throws if the shape doesn't match. */
function parseMonthColumnHeader(raw: string): { year: number; monthIndex0: number } {
  const match = /^([A-Za-z]+)-(\d{2})$/.exec(raw.trim())
  if (!match) {
    throw new RetailerFormatError(`${LABEL}: expected a "Mon-YY" month header (e.g. "Aug-26"), got "${raw}"`)
  }
  const monthIndex0 = parseMonthAbbreviation(match[1])
  if (monthIndex0 === null) {
    throw new RetailerFormatError(`${LABEL}: unrecognized month abbreviation "${match[1]}" in header "${raw}"`)
  }
  return { year: 2000 + Number(match[2]), monthIndex0 }
}

/** e.g. "groa Brow Serum" -> "GROA"; everything else (UKLASH/UKBROW/UKHAIR/UKLIPS) -> "UKLASH". Not seen in this file yet, but kept consistent with ASOS/Boots in case a future month includes it. */
function deriveBrand(productName: string): string {
  return productName.trim().toLowerCase().startsWith('groa') ? 'GROA' : 'UKLASH'
}

function parseSheet(sheetName: string, grid: unknown[][]): ParsedRow[] {
  const headerRowIndex = findHeaderRowIndex(grid, REQUIRED_HEADERS)
  if (headerRowIndex === -1) {
    throw new RetailerFormatError(
      `${LABEL}, tab "${sheetName}": doesn't look right — couldn't find a header row containing ${REQUIRED_HEADERS.map((h) => `"${h}"`).join(', ')}.`,
    )
  }
  const groupRow = grid[headerRowIndex - 1] ?? []
  const headerRow = grid[headerRowIndex]

  const descriptionCol = headerRow.findIndex((c) => cellToString(c) === 'DESCRIPTION')
  const monthUnitsCol = descriptionCol + 1
  const monthRevenueCol = descriptionCol + 2
  if (descriptionCol === -1 || cellToString(headerRow[monthRevenueCol]).replace(/\s+/g, ' ').toLowerCase().indexOf('sales') === -1) {
    throw new RetailerFormatError(`${LABEL}, tab "${sheetName}": expected a "<Month> £ sales" column right after the month-units column.`)
  }
  const { year, monthIndex0 } = parseMonthColumnHeader(cellToString(headerRow[monthUnitsCol]))
  const weekEnding = lastDayOfMonth(year, monthIndex0)
  const dateFields = deriveDateFields(weekEnding)

  // Each week contributes exactly 2 columns (STORES, WEB units), sharing the same
  // week-code label (e.g. "202632") in the header row. Scan them dynamically
  // rather than assuming a fixed count — months have 4 or 5 weeks.
  const weekColumnPairs: { storeCol: number; webCol: number }[] = []
  let col = monthRevenueCol + 1
  while (/^\d{6}$/.test(cellToString(headerRow[col]))) {
    const weekCode = cellToString(headerRow[col])
    const storeLabel = cellToString(groupRow[col])
    const webLabel = cellToString(groupRow[col + 1])
    const webWeekCode = cellToString(headerRow[col + 1])
    if (storeLabel !== 'STORES' || webLabel !== 'WEB' || webWeekCode !== weekCode) {
      throw new RetailerFormatError(
        `${LABEL}, tab "${sheetName}": expected a "STORES"/"WEB" column pair for week ${weekCode} at columns ${col}/${col + 1} — the report layout may have changed.`,
      )
    }
    weekColumnPairs.push({ storeCol: col, webCol: col + 1 })
    col += 2
  }
  if (weekColumnPairs.length === 0) {
    throw new RetailerFormatError(`${LABEL}, tab "${sheetName}": couldn't find any weekly STORES/WEB unit columns.`)
  }

  const dataRows = grid.slice(headerRowIndex + 1)
  const rows: ParsedRow[] = []

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + 2 + i
    const productTitle = cellToString(row?.[descriptionCol])
    if (!productTitle) return // trailing blank row

    const monthUnitsRaw = cellToString(row[monthUnitsCol])
    const monthUnits = parseIntegerUnits(monthUnitsRaw)
    if (monthUnits === null) {
      throw new RetailerFormatError(`${LABEL}, tab "${sheetName}" row ${rowNumber}: expected a whole number for month units, got "${monthUnitsRaw}"`)
    }

    const monthRevenueRaw = cellToString(row[monthRevenueCol])
    const monthRevenue = parseCurrencyToNumber(monthRevenueRaw)
    if (monthRevenue === null) {
      throw new RetailerFormatError(`${LABEL}, tab "${sheetName}" row ${rowNumber}: expected a number for month revenue, got "${monthRevenueRaw}"`)
    }

    // Defensive cross-check: the weekly Store+Web units should sum to the
    // stated month total. Catches the report layout drifting silently.
    let summedUnits = 0
    for (const { storeCol, webCol } of weekColumnPairs) {
      const storeUnits = parseIntegerUnits(cellToString(row[storeCol]) || '0')
      const webUnits = parseIntegerUnits(cellToString(row[webCol]) || '0')
      if (storeUnits === null || webUnits === null) {
        throw new RetailerFormatError(`${LABEL}, tab "${sheetName}" row ${rowNumber} (${productTitle}): expected whole numbers for weekly units.`)
      }
      summedUnits += storeUnits + webUnits
    }
    if (summedUnits !== monthUnits) {
      throw new RetailerFormatError(
        `${LABEL}, tab "${sheetName}" row ${rowNumber} (${productTitle}): weekly Store+Web units sum to ${summedUnits}, but the month total column says ${monthUnits} — the report layout may have changed.`,
      )
    }

    rows.push({
      RETAILER: LABEL,
      BRAND: deriveBrand(productTitle),
      PRODUCT_TITLE: productTitle,
      ...dateFields,
      SALES_AMOUNT: roundToPence(monthRevenue),
      SALES_UNITS: monthUnits,
      // PROVISIONAL: revenue is only reported monthly and blended across
      // Store+Web (no way to split it by channel without estimating) — see
      // README "Open provisional decisions". CHANNEL/STORE_LOCATION/REGION
      // here are a placeholder pending a decision with the business.
      CHANNEL: 'Store',
      STORE_LOCATION: 'All Stores',
      REGION: 'All Stores',
      PERIOD: 'MONTH',
    })
  })

  return rows
}

export const oliverBonas: RetailerParser = {
  key: 'oliver-bonas',
  label: LABEL,
  skuLevel: true,

  detect(sheet: RawSheet): number {
    if (!sheet.sheets) return 0
    const sheetNames = Object.keys(sheet.sheets)
    const matching = sheetNames.filter((name) => findHeaderRowIndex(sheet.sheets![name], REQUIRED_HEADERS) !== -1)
    return matching.length > 0 ? Math.min(matching.length / sheetNames.length, 1) : 0
  },

  parse(sheet: RawSheet): ParsedRow[] {
    if (!sheet.sheets) {
      throw new RetailerFormatError(`Expected a multi-tab ${LABEL} workbook (.xlsx, one tab per month) — got a single-sheet/CSV file.`)
    }
    const rows: ParsedRow[] = []
    for (const [sheetName, grid] of Object.entries(sheet.sheets)) {
      rows.push(...parseSheet(sheetName, grid))
    }
    return rows
  },
}
