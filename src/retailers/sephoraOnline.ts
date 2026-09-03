import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { findHeaderRowIndex } from '../lib/rawSheet'
import { weekEndingFromIsoYearWeek, deriveDateFields } from '../lib/dateUtils'
import { parseCurrencyToNumber, parseIntegerUnits, roundToPence } from '../lib/currency'

const LABEL = 'Sephora'
const SHEET_NAME = 'Weekly Sales By Product'

// Anchor headers: unique (not repeated across the UK/Other/Total column groups).
const REQUIRED_HEADERS = ['Year Week', 'Product', 'EAN Code', 'Vendor Code']

function cellStr(cell: unknown): string {
  return cell === null || cell === undefined ? '' : String(cell).trim()
}

export const sephoraOnline: RetailerParser = {
  key: 'sephora-online',
  label: 'Sephora (Online)',
  skuLevel: true,

  detect(sheet: RawSheet): number {
    // No filename convention to go on (Sephora's export is always named
    // generically, e.g. "UKLASH (22).xlsx") — rely entirely on the tab
    // existing with the expected header shape.
    if (!sheet.sheets || !sheet.sheets[SHEET_NAME]) return 0
    return findHeaderRowIndex(sheet.sheets[SHEET_NAME], REQUIRED_HEADERS) !== -1 ? 1 : 0
  },

  parse(sheet: RawSheet): ParsedRow[] {
    if (!sheet.sheets) {
      throw new RetailerFormatError(
        `Expected a multi-tab Sephora workbook (.xlsx) with a "${SHEET_NAME}" tab — got a single-sheet/CSV file.`,
      )
    }
    const grid = sheet.sheets[SHEET_NAME]
    if (!grid) {
      throw new RetailerFormatError(
        `Couldn't find a "${SHEET_NAME}" tab in this workbook. Tabs found: ${Object.keys(sheet.sheets).join(', ')}`,
      )
    }

    const headerRowIndex = findHeaderRowIndex(grid, REQUIRED_HEADERS)
    if (headerRowIndex === -1) {
      throw new RetailerFormatError(
        `"${SHEET_NAME}" doesn't look like a Sephora export — couldn't find a header row containing ` +
          `${REQUIRED_HEADERS.map((h) => `"${h}"`).join(', ')}.`,
      )
    }
    const headerRow = grid[headerRowIndex] ?? []
    const groupRow = grid[headerRowIndex - 1] ?? [] // the "UK" / "Other" / "Total" row above the header row

    const yearWeekCol = headerRow.findIndex((c) => cellStr(c) === 'Year Week')
    const productCol = headerRow.findIndex((c) => cellStr(c) === 'Product')
    if (yearWeekCol === -1 || productCol === -1) {
      throw new RetailerFormatError(`"${SHEET_NAME}": couldn't locate "Year Week"/"Product" columns.`)
    }

    // The "Units Sold"/"Sales Ex Vat" headers repeat once per column group
    // (UK, Other, Total) — we want the combined "Total" group specifically.
    // Locate it via the group-label row, then verify the sub-headers at
    // the expected offsets, so a layout change fails loudly instead of
    // silently reading the wrong group.
    const totalGroupCol = groupRow.findIndex((c) => cellStr(c) === 'Total')
    if (totalGroupCol === -1) {
      throw new RetailerFormatError(`"${SHEET_NAME}": couldn't find the "Total" column group.`)
    }
    const unitsSoldCol = totalGroupCol
    const salesExVatCol = totalGroupCol + 3
    if (cellStr(headerRow[unitsSoldCol]) !== 'Units Sold' || cellStr(headerRow[salesExVatCol]) !== 'Sales Ex Vat') {
      throw new RetailerFormatError(
        `"${SHEET_NAME}": expected "Units Sold" and "Sales Ex Vat" under the "Total" group at columns ` +
          `${unitsSoldCol}/${salesExVatCol}, but found "${cellStr(headerRow[unitsSoldCol])}"/"${cellStr(headerRow[salesExVatCol])}" — the report layout may have changed.`,
      )
    }

    const dataRows = grid.slice(headerRowIndex + 1)
    const normalized: ParsedRow[] = []
    let currentYearWeek: string | null = null

    dataRows.forEach((row, i) => {
      const rowNumber = headerRowIndex + 2 + i
      if (!row || row.every((c) => cellStr(c) === '')) return // trailing blank row

      const yearWeekCell = cellStr(row[yearWeekCol])
      if (yearWeekCell) currentYearWeek = yearWeekCell // "Year Week" is only populated on the first row of each week (merged cells)

      const product = cellStr(row[productCol])
      // Per-week and grand-total subtotal rows have Product === "Total" — skip them.
      if (!product || product === 'Total') return

      if (!currentYearWeek) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: no "Year Week" value in effect (missing from the top of the file).`)
      }
      const match = /^(\d{4})\s+(\d{1,2})$/.exec(currentYearWeek)
      if (!match) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: "Year Week" value "${currentYearWeek}" isn't in the expected "YYYY WW" shape.`)
      }
      const weekEnding = weekEndingFromIsoYearWeek(Number(match[1]), Number(match[2]))

      // Blank means zero throughout this report (seen consistently across
      // UK/Other/Total groups: a blank current-period figure routinely
      // pairs with populated last-year/YoY comparison figures) — not a
      // missing-data error.
      const unitsRaw = cellStr(row[unitsSoldCol])
      const salesUnits = unitsRaw === '' ? 0 : parseIntegerUnits(unitsRaw)
      if (salesUnits === null) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: expected a whole number for total "Units Sold", got "${unitsRaw}"`)
      }

      const salesRaw = cellStr(row[salesExVatCol])
      const salesAmount = salesRaw === '' ? 0 : parseCurrencyToNumber(salesRaw)
      if (salesAmount === null) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: expected a number for total "Sales Ex Vat", got "${salesRaw}"`)
      }

      normalized.push({
        RETAILER: LABEL,
        BRAND: 'UKLASH',
        PRODUCT_TITLE: product,
        ...deriveDateFields(weekEnding),
        SALES_AMOUNT: roundToPence(salesAmount),
        SALES_UNITS: salesUnits,
        CHANNEL: 'Online',
        STORE_LOCATION: 'Online',
        REGION: 'Online',
        PERIOD: 'WEEK',
      })
    })

    return normalized
  },
}
