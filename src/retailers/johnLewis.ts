import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { findHeaderRowIndex, gridRowsFromHeader } from '../lib/rawSheet'
import { parseDDMMYYYY, weekEndingFromSundayWeekStart, deriveDateFields } from '../lib/dateUtils'
import { parseCurrencyToNumber, parseIntegerUnits, roundToPence } from '../lib/currency'

const LABEL = 'John Lewis'
const ONLINE_BRANCH_NAME = 'John Lewis.com'

const REQUIRED_HEADERS = [
  'Week Start Date',
  'Branch Name',
  'Product Description',
  'Sales Units',
  'Sales Value',
]

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return value === null || value === undefined ? '' : String(value).trim()
}

/**
 * PROVISIONAL — REGION has no source column in the JLP file. Stripping the
 * "John Lewis " prefix gives a place name (e.g. "Cardiff"), not a true UK
 * region grouping. Confirmed as good enough for now; revisit for
 * consistency once the other retailers' region data is in.
 */
function deriveRegion(branchName: string): string {
  return branchName.startsWith('John Lewis ') ? branchName.slice('John Lewis '.length).trim() : branchName
}

function parseIntStrict(raw: string, rowNumber: number, field: string): number {
  const value = parseIntegerUnits(raw)
  if (value === null) {
    throw new RetailerFormatError(`${LABEL} row ${rowNumber}: expected a whole number for "${field}", got "${raw}"`)
  }
  return value
}

export const johnLewis: RetailerParser = {
  key: 'john-lewis',
  label: LABEL,
  skuLevel: true,

  detect(sheet: RawSheet): number {
    let score = 0
    const name = sheet.fileName.toLowerCase()
    if (name.includes('jlp') || name.includes('john lewis') || name.includes('johnlewis')) score += 0.6
    if (findHeaderRowIndex(sheet.rawGrid, REQUIRED_HEADERS) !== -1) score += 0.4
    return Math.min(score, 1)
  },

  parse(sheet: RawSheet): ParsedRow[] {
    const headerRowIndex = findHeaderRowIndex(sheet.rawGrid, REQUIRED_HEADERS)
    if (headerRowIndex === -1) {
      throw new RetailerFormatError(
        `This doesn't look like a ${LABEL} export — couldn't find a header row containing ` +
          `${REQUIRED_HEADERS.map((h) => `"${h}"`).join(', ')}.`,
      )
    }

    const rows = gridRowsFromHeader(sheet.rawGrid, headerRowIndex)
    if (rows.length === 0) {
      throw new RetailerFormatError(`${LABEL} file has a header row but no data rows underneath it.`)
    }

    return rows.map((row, i) => {
      const rowNumber = headerRowIndex + 2 + i // 1-based, matching the row number in the source file

      const weekStartRaw = cell(row, 'Week Start Date')
      if (!weekStartRaw) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: missing "Week Start Date"`)
      }
      const weekStart = parseDDMMYYYY(weekStartRaw)
      const weekEnding = weekEndingFromSundayWeekStart(weekStart)

      const branchName = cell(row, 'Branch Name')
      if (!branchName) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: missing "Branch Name"`)
      }
      const isOnline = branchName === ONLINE_BRANCH_NAME
      const channel = isOnline ? 'Online' : 'Store'
      const storeLocation = isOnline ? 'Online' : branchName
      const region = isOnline ? 'Online' : deriveRegion(branchName)

      const productTitle = cell(row, 'Product Description') || null

      const salesUnits = parseIntStrict(cell(row, 'Sales Units'), rowNumber, 'Sales Units')

      const salesAmountRaw = cell(row, 'Sales Value')
      const salesAmount = parseCurrencyToNumber(salesAmountRaw)
      if (salesAmount === null) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: "Sales Value" isn't a valid number ("${salesAmountRaw}")`)
      }

      return {
        RETAILER: LABEL,
        BRAND: 'UKLASH',
        PRODUCT_TITLE: productTitle,
        ...deriveDateFields(weekEnding),
        SALES_AMOUNT: roundToPence(salesAmount),
        SALES_UNITS: salesUnits,
        CHANNEL: channel,
        STORE_LOCATION: storeLocation,
        REGION: region,
        PERIOD: 'WEEK',
      }
    })
  },
}
