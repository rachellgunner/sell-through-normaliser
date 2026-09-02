import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { cellToString, findHeaderRowIndex } from '../lib/rawSheet'
import { parseDDMMYYYY, weekEndingSunday, formatDDMMYYYY, deriveDateFields } from '../lib/dateUtils'
import { parseCurrencyToNumber, roundToPence } from '../lib/currency'

const LABEL = 'ASOS'

// Anchor headers for the per-product-per-week report (the "Overview" tab —
// combined across ASOS's warehouse-split tabs, which report the same
// figures broken down by fulfilment centre and aren't needed separately).
const REQUIRED_HEADERS = ['Division', 'Style', 'Option Id', 'Option', 'Supplier Product Reference', 'Retail Sales Units', 'Retail Sales Value']

const WEEK_LABEL_PATTERN = /Last Week:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/

function findOverviewSheet(sheets: Record<string, unknown[][]>): { name: string; grid: unknown[][] } | null {
  const name = Object.keys(sheets).find((n) => n.toLowerCase().startsWith('overview'))
  return name ? { name, grid: sheets[name] } : null
}

function extractWeekEnding(grid: unknown[][]): Date {
  // The report period lives as free text in the top-left cell, e.g.
  // "Last Week: 24/08/2026  -  30/08/2026" — not a real date cell.
  for (const row of grid.slice(0, 3)) {
    const text = cellToString(row?.[0])
    const match = WEEK_LABEL_PATTERN.exec(text)
    if (match) {
      const weekEnding = parseDDMMYYYY(match[2])
      // ASOS's own end date should already be a Monday-start week's Sunday —
      // verify rather than assume, since a mismatch would mean the report
      // convention has changed and every derived week/period field would be wrong.
      if (formatDDMMYYYY(weekEndingSunday(weekEnding)) !== formatDDMMYYYY(weekEnding)) {
        throw new RetailerFormatError(
          `${LABEL}: report period end date "${match[2]}" isn't a Sunday closing a Monday-start week as expected — the week convention may have changed.`,
        )
      }
      return weekEnding
    }
  }
  throw new RetailerFormatError(`${LABEL}: couldn't find a "Last Week: DD/MM/YYYY - DD/MM/YYYY" report period label.`)
}

/** e.g. "Groa Lash Serum - NOC" -> "GROA"; everything else (UKLASH/UKBROW/UKHAIR/UKLIPS) -> "UKLASH". */
function deriveBrand(productName: string): string {
  return productName.trim().toLowerCase().startsWith('groa') ? 'GROA' : 'UKLASH'
}

export const asos: RetailerParser = {
  key: 'asos',
  label: 'ASOS',
  skuLevel: true,

  detect(sheet: RawSheet): number {
    let score = 0
    if (sheet.fileName.toLowerCase().includes('asos')) score += 0.6
    if (sheet.sheets) {
      const overview = findOverviewSheet(sheet.sheets)
      if (overview && findHeaderRowIndex(overview.grid, REQUIRED_HEADERS) !== -1) score += 0.4
    }
    return Math.min(score, 1)
  },

  parse(sheet: RawSheet): ParsedRow[] {
    if (!sheet.sheets) {
      throw new RetailerFormatError(`Expected a multi-tab ASOS workbook (.xlsx) with an "Overview" tab — got a single-sheet/CSV file.`)
    }
    const overview = findOverviewSheet(sheet.sheets)
    if (!overview) {
      throw new RetailerFormatError(`Couldn't find an "Overview" tab in this workbook. Tabs found: ${Object.keys(sheet.sheets).join(', ')}`)
    }
    const grid = overview.grid

    const weekEnding = extractWeekEnding(grid)
    const dateFields = deriveDateFields(weekEnding)

    const headerRowIndex = findHeaderRowIndex(grid, REQUIRED_HEADERS)
    if (headerRowIndex === -1) {
      throw new RetailerFormatError(
        `"${overview.name}" doesn't look like an ASOS export — couldn't find a header row containing ${REQUIRED_HEADERS.map((h) => `"${h}"`).join(', ')}.`,
      )
    }
    const headerRow = grid[headerRowIndex]
    const optionIdCol = headerRow.findIndex((c) => cellToString(c) === 'Option Id')
    const optionCol = headerRow.findIndex((c) => cellToString(c) === 'Option')
    const unitsCol = headerRow.findIndex((c) => cellToString(c) === 'Retail Sales Units')
    const salesCol = headerRow.findIndex((c) => cellToString(c) === 'Retail Sales Value')
    if ([optionIdCol, optionCol, unitsCol, salesCol].includes(-1)) {
      throw new RetailerFormatError(`"${overview.name}": couldn't locate one of the required columns.`)
    }

    // Each product appears once per price-status tier (Full Price, Promo,
    // Markdown, ...) for the week — sum them into a single row per
    // product, matching every other retailer's one-row-per-product-per-week shape.
    const byProduct = new Map<string, { name: string; units: number; sales: number }>()

    const dataRows = grid.slice(headerRowIndex + 1)
    dataRows.forEach((row, i) => {
      const rowNumber = headerRowIndex + 2 + i
      if (!row || row.every((c) => cellToString(c) === '')) return // trailing blank row

      const optionId = cellToString(row[optionIdCol])
      if (!optionId) return

      const productName = cellToString(row[optionCol])
      const unitsRaw = cellToString(row[unitsCol])
      const salesRaw = cellToString(row[salesCol])

      const units = unitsRaw === '' ? 0 : Number(unitsRaw)
      if (!Number.isFinite(units) || !Number.isInteger(units)) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: expected a whole number for "Retail Sales Units", got "${unitsRaw}"`)
      }
      const sales = salesRaw === '' ? 0 : parseCurrencyToNumber(salesRaw)
      if (sales === null) {
        throw new RetailerFormatError(`${LABEL} row ${rowNumber}: expected a number for "Retail Sales Value", got "${salesRaw}"`)
      }

      const existing = byProduct.get(optionId)
      if (existing) {
        existing.units += units
        existing.sales += sales
      } else {
        byProduct.set(optionId, { name: productName, units, sales })
      }
    })

    return [...byProduct.values()].map((p) => ({
      RETAILER: LABEL,
      BRAND: deriveBrand(p.name),
      PRODUCT_TITLE: p.name,
      ...dateFields,
      SALES_AMOUNT: roundToPence(p.sales),
      SALES_UNITS: p.units,
      CHANNEL: 'Online' as const,
      STORE_LOCATION: 'Online',
      REGION: 'Online',
      PERIOD: 'WEEK',
    }))
  },
}
