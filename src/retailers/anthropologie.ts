import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { findHeaderRowIndex, cellToString } from '../lib/rawSheet'
import { deriveDateFields, lastDayOfMonth, parseMonthAbbreviation } from '../lib/dateUtils'
import { parseCurrencyToNumber, parseIntegerUnits, roundToPence } from '../lib/currency'

const LABEL = 'Anthropologie'
const TOTAL_ROW_LABEL = 'Total' // the report's own subtotal row — not a real product, excluded from output

// "Sales U"/"Sales R" are unique anchors; the file has no header text at
// all for the product-description column (it sits right before "Sales U").
const REQUIRED_HEADERS = ['Sales U', 'Sales R']

/** Sent one month per file — the period lives as free text like "FY27_CY26 Aug" rather than any real date cell. */
function findReportPeriod(grid: unknown[][]): { year: number; monthIndex0: number } {
  for (const row of grid) {
    for (const cell of row ?? []) {
      const text = cellToString(cell)
      const match = /^FY\d{2}_CY(\d{2})\s+([A-Za-z]+)$/.exec(text)
      if (match) {
        const monthIndex0 = parseMonthAbbreviation(match[2])
        if (monthIndex0 === null) {
          throw new RetailerFormatError(`${LABEL}: unrecognized month abbreviation "${match[2]}" in period label "${text}"`)
        }
        return { year: 2000 + Number(match[1]), monthIndex0 }
      }
    }
  }
  throw new RetailerFormatError(`${LABEL}: couldn't find a "FY##_CY## Mon" report period label anywhere in the sheet.`)
}

/** e.g. "groa Brow Serum" -> "GROA"; everything else (UKLASH/UKBROW/UKHAIR) -> "UKLASH". Not seen in this file yet, but kept consistent with other retailers in case a future month includes it. */
function deriveBrand(productName: string): string {
  return productName.trim().toLowerCase().startsWith('groa') ? 'GROA' : 'UKLASH'
}

export const anthropologie: RetailerParser = {
  key: 'anthropologie',
  label: LABEL,
  skuLevel: true,

  detect(sheet: RawSheet): number {
    return findHeaderRowIndex(sheet.rawGrid, REQUIRED_HEADERS) !== -1 ? 1 : 0
  },

  parse(sheet: RawSheet): ParsedRow[] {
    const grid = sheet.rawGrid
    const headerRowIndex = findHeaderRowIndex(grid, REQUIRED_HEADERS)
    if (headerRowIndex === -1) {
      throw new RetailerFormatError(
        `This doesn't look like an ${LABEL} export — couldn't find a header row containing ${REQUIRED_HEADERS.map((h) => `"${h}"`).join(', ')}.`,
      )
    }
    const headerRow = grid[headerRowIndex]
    const salesUnitsCol = headerRow.findIndex((c) => cellToString(c) === 'Sales U')
    const salesRevenueCol = headerRow.findIndex((c) => cellToString(c) === 'Sales R')
    const descriptionCol = salesUnitsCol - 1 // unlabeled in the source, sits directly before "Sales U"
    const vendorStyleCol = 0 // used only to spot the "Total" subtotal row
    if (salesUnitsCol === -1 || salesRevenueCol === -1 || descriptionCol < 0) {
      throw new RetailerFormatError(`${LABEL}: couldn't locate the "Sales U"/"Sales R"/description columns.`)
    }

    const { year, monthIndex0 } = findReportPeriod(grid)
    const dateFields = deriveDateFields(lastDayOfMonth(year, monthIndex0))

    const dataRows = grid.slice(headerRowIndex + 1)
    const rows: ParsedRow[] = []

    dataRows.forEach((row, i) => {
      const rowNumber = headerRowIndex + 2 + i
      if (!row || row.every((c) => cellToString(c) === '')) return // trailing blank row
      if (cellToString(row[vendorStyleCol]) === TOTAL_ROW_LABEL) return // the report's own subtotal row

      const productTitle = cellToString(row[descriptionCol])
      if (!productTitle) return

      const unitsRaw = cellToString(row[salesUnitsCol])
      const salesUnits = parseIntegerUnits(unitsRaw)
      if (salesUnits === null) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber} (${productTitle}): expected a whole number for "Sales U", got "${unitsRaw}"`)
      }

      const revenueRaw = cellToString(row[salesRevenueCol])
      const salesAmount = parseCurrencyToNumber(revenueRaw)
      if (salesAmount === null) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber} (${productTitle}): expected a number for "Sales R", got "${revenueRaw}"`)
      }

      rows.push({
        RETAILER: LABEL,
        BRAND: deriveBrand(productTitle),
        PRODUCT_TITLE: productTitle,
        ...dateFields,
        SALES_AMOUNT: roundToPence(salesAmount),
        SALES_UNITS: salesUnits,
        // No channel signal anywhere in the file (no Store/Web split,
        // nothing to infer it from) — "Unknown" rather than guessing.
        // See README "Open provisional decisions".
        CHANNEL: 'Unknown',
        STORE_LOCATION: 'Unknown',
        REGION: 'Unknown',
        PERIOD: 'MONTH',
      })
    })

    return rows
  },
}
