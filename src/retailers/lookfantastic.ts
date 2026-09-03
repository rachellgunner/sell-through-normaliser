import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { parseYYYYMMDD, weekEndingSunday, formatDDMMYYYY, deriveDateFields } from '../lib/dateUtils'
import { parseCurrencyToNumber, parseIntegerUnits, roundToPence } from '../lib/currency'

const LABEL = 'Lookfantastic'

// Note: the file's own name doesn't mention "Lookfantastic" at all (it's
// exported under the legal entity name "UK Skinlabs Limited"), so
// detection relies entirely on this distinctive header shape.
const REQUIRED_HEADERS = [
  'Week_Start_Date',
  'Week_End_Date',
  'Barcode',
  'Product_ID',
  'Brand_Name',
  'Product_Title',
  'Site_Name',
  'Revenue',
  'Sale_Volume_Units',
]

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return value === null || value === undefined ? '' : String(value).trim()
}

export const lookfantastic: RetailerParser = {
  key: 'lookfantastic',
  label: LABEL,
  skuLevel: true,

  detect(sheet: RawSheet): number {
    return REQUIRED_HEADERS.every((h) => sheet.headers.includes(h)) ? 1 : 0
  },

  parse(sheet: RawSheet): ParsedRow[] {
    const missing = REQUIRED_HEADERS.filter((h) => !sheet.headers.includes(h))
    if (missing.length > 0) {
      throw new RetailerFormatError(
        `This doesn't look like a ${LABEL} export — missing column(s): ${missing.map((h) => `"${h}"`).join(', ')}.`,
      )
    }
    if (sheet.rows.length === 0) {
      throw new RetailerFormatError(`${LABEL} file has a header row but no data rows underneath it.`)
    }

    return sheet.rows.map((row, i) => {
      const rowNumber = i + 2 // 1-based, matching the row number in the source file

      const weekEndRaw = cell(row, 'Week_End_Date')
      if (!weekEndRaw) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: missing "Week_End_Date"`)
      }
      const weekEnding = parseYYYYMMDD(weekEndRaw)
      // Confirmed consistent across the whole file at build time, but
      // verify per-row anyway — a future export with a different week
      // convention should fail loudly rather than silently mislabel weeks.
      if (formatDDMMYYYY(weekEndingSunday(weekEnding)) !== formatDDMMYYYY(weekEnding)) {
        throw new RetailerFormatError(
          `${LABEL} row ${rowNumber}: "Week_End_Date" (${weekEndRaw}) isn't a Sunday closing a Monday-start week as expected.`,
        )
      }

      const productTitle = cell(row, 'Product_Title')
      if (!productTitle) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: missing "Product_Title"`)
      }

      const unitsRaw = cell(row, 'Sale_Volume_Units')
      const salesUnits = parseIntegerUnits(unitsRaw)
      if (salesUnits === null) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: expected a whole number for "Sale_Volume_Units", got "${unitsRaw}"`)
      }

      const revenueRaw = cell(row, 'Revenue')
      const salesAmount = parseCurrencyToNumber(revenueRaw)
      if (salesAmount === null) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: "Revenue" isn't a valid number ("${revenueRaw}")`)
      }

      const brand = cell(row, 'Brand_Name').toUpperCase() || 'UKLASH'

      return {
        RETAILER: LABEL,
        BRAND: brand,
        PRODUCT_TITLE: productTitle,
        ...deriveDateFields(weekEnding),
        SALES_AMOUNT: roundToPence(salesAmount),
        SALES_UNITS: salesUnits,
        CHANNEL: 'Online',
        STORE_LOCATION: 'Online',
        REGION: 'Online',
        PERIOD: 'WEEK',
      }
    })
  },
}
