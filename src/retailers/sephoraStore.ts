import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { findHeaderRowIndex, cellToString, discoverColumnGroups, findSubColumnOffset } from '../lib/rawSheet'
import { weekEndingFromIsoYearWeek, deriveDateFields } from '../lib/dateUtils'
import { parseCurrencyToNumber, roundToPence } from '../lib/currency'

const LABEL = 'Sephora'
const SHEET_NAME = 'Weekly Sales By Product'
const TOTAL_GROUP_NAME = 'Total' // the store-estate aggregate column group — not a real store, excluded from output

// Anchor headers: unique (not repeated once per store column group).
const REQUIRED_HEADERS = ['Year Week', 'Product', 'Vendor Item No', 'EAN Code']

/** e.g. "Manchester (Trafford)" -> "Manchester" — matches the spec's own example format. */
function deriveRegion(storeName: string): string {
  const match = /^(.*?)\s*\(/.exec(storeName)
  return match ? match[1].trim() : storeName
}

export const sephoraStore: RetailerParser = {
  key: 'sephora-store',
  label: 'Sephora (Store)',
  skuLevel: true,

  detect(sheet: RawSheet): number {
    if (!sheet.sheets || !sheet.sheets[SHEET_NAME]) return 0
    const grid = sheet.sheets[SHEET_NAME]
    const headerRowIndex = findHeaderRowIndex(grid, REQUIRED_HEADERS)
    if (headerRowIndex === -1) return 0
    // Distinguish from Sephora Online, which has the same sheet name but a
    // "UK"/"Other"/"Total" group row instead of one group per store.
    const groupRow = grid[headerRowIndex - 1] ?? []
    const hasStoreGroups = discoverColumnGroups(groupRow, groupRow.length).length > 3
    return hasStoreGroups ? 1 : 0
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
    const groupRow = grid[headerRowIndex - 1] ?? []

    const yearWeekCol = headerRow.findIndex((c) => cellToString(c) === 'Year Week')
    const productCol = headerRow.findIndex((c) => cellToString(c) === 'Product')
    if (yearWeekCol === -1 || productCol === -1) {
      throw new RetailerFormatError(`"${SHEET_NAME}": couldn't locate "Year Week"/"Product" columns.`)
    }

    const groups = discoverColumnGroups(groupRow, headerRow.length)
    const storeGroups = groups.filter((g) => g.name !== TOTAL_GROUP_NAME)
    if (storeGroups.length === 0) {
      throw new RetailerFormatError(`"${SHEET_NAME}": couldn't find any per-store column groups.`)
    }

    // For each store group, locate its "Sales Ex Vat"/"Units Sold" columns
    // by scanning within the group rather than assuming a fixed offset —
    // real exports here have an inconsistent extra spacer column in some
    // groups but not others.
    const storeColumns = storeGroups.map((group) => {
      const salesOffset = findSubColumnOffset(headerRow, group, 'Sales Ex Vat')
      const unitsOffset = findSubColumnOffset(headerRow, group, 'Units Sold')
      if (salesOffset === -1 || unitsOffset === -1) {
        throw new RetailerFormatError(
          `"${SHEET_NAME}": store group "${group.name}" is missing a "Sales Ex Vat"/"Units Sold" sub-column — the report layout may have changed.`,
        )
      }
      return {
        storeName: group.name,
        region: deriveRegion(group.name),
        salesCol: group.startCol + salesOffset,
        unitsCol: group.startCol + unitsOffset,
      }
    })

    const dataRows = grid.slice(headerRowIndex + 1)
    const normalized: ParsedRow[] = []
    let currentYearWeek: string | null = null

    dataRows.forEach((row, i) => {
      const rowNumber = headerRowIndex + 2 + i
      if (!row || row.every((c) => cellToString(c) === '')) return // trailing blank row

      const yearWeekCell = cellToString(row[yearWeekCol])
      if (yearWeekCell) currentYearWeek = yearWeekCell // "Year Week" only populated on the first row of each week (merged cells)

      const product = cellToString(row[productCol])
      if (!product || product === 'Total') return // per-week and grand-total subtotal rows

      if (!currentYearWeek) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: no "Year Week" value in effect (missing from the top of the file).`)
      }
      const match = /^(\d{4})\s+wk(\d{1,2})$/i.exec(currentYearWeek)
      if (!match) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: "Year Week" value "${currentYearWeek}" isn't in the expected "YYYY wkWW" shape.`)
      }
      const weekEnding = weekEndingFromIsoYearWeek(Number(match[1]), Number(match[2]))
      const dateFields = deriveDateFields(weekEnding)

      for (const store of storeColumns) {
        // Blank means zero throughout this report (same convention as
        // Sephora Online) — skip emitting a row only when there's truly no
        // sale at all for this store/product/week, to avoid an explosion
        // of all-zero rows across 17 stores x every product x every week.
        const unitsRaw = cellToString(row[store.unitsCol])
        const salesRaw = cellToString(row[store.salesCol])
        if (unitsRaw === '' && salesRaw === '') continue

        const salesUnits = unitsRaw === '' ? 0 : Number(unitsRaw)
        if (!Number.isFinite(salesUnits) || !Number.isInteger(salesUnits)) {
          throw new RetailerFormatError(
            `${LABEL} row ${rowNumber} (${store.storeName}): expected a whole number for "Units Sold", got "${unitsRaw}"`,
          )
        }
        const salesAmount = salesRaw === '' ? 0 : parseCurrencyToNumber(salesRaw)
        if (salesAmount === null) {
          throw new RetailerFormatError(
            `${LABEL} row ${rowNumber} (${store.storeName}): expected a number for "Sales Ex Vat", got "${salesRaw}"`,
          )
        }

        normalized.push({
          RETAILER: LABEL,
          BRAND: 'UKLASH',
          PRODUCT_TITLE: product,
          ...dateFields,
          SALES_AMOUNT: roundToPence(salesAmount),
          SALES_UNITS: salesUnits,
          CHANNEL: 'Store',
          STORE_LOCATION: store.storeName,
          REGION: store.region,
          PERIOD: 'WEEK',
        })
      }
    })

    return normalized
  },
}
