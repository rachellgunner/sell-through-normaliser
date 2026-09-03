import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { findHeaderRowIndex, cellToString, discoverColumnGroups, findSubColumnOffset, groupRunsByLabel } from '../lib/rawSheet'
import { weekEndingFromIsoYearWeek, deriveDateFields, mondayOfWeek } from '../lib/dateUtils'
import { parseCurrencyToNumber, parseIntegerUnits, roundToPence } from '../lib/currency'

const LABEL = 'Selfridges'
const REVENUE_SHEET = 'Sales By WK'
const UNITS_SHEET = 'Sales by SKU - Units'
const AGGREGATE_GROUP_NAME = 'COMPANY' // the store-estate total column group — not a real store

// Per the spec, Selfridges only has store-level revenue available (no
// per-product revenue anywhere in the file — see README "Open provisional
// decisions"), so PRODUCT_TITLE is null here, like Boots/Oliver Bonas.
const SKU_LEVEL = false

/** "OXFORD STREET" -> "Oxford Street". Also used to canonicalize before matching between the two tabs (which use different casing). */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Known Selfridges UK store -> region. Extend here if a new store appears (throws below if not recognized, rather than guessing). */
const REGION_BY_STORE: Record<string, string> = {
  'Oxford Street': 'London',
  Trafford: 'Manchester',
  'Exchange Square': 'Manchester',
  Birmingham: 'Birmingham',
}

const MONTH_TOKEN_TO_MONTH_INDEX0: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APRIL: 3,
  MAY: 4,
  JUN: 5,
  JUNE: 5,
  JULY: 6,
  AUG: 7,
  SEPT: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
}

/** Extract a plausible 4-digit calendar year from the filename (e.g. "UK Lash 2026 (2).xlsx" -> 2026). */
function extractYearFromFileName(fileName: string): number {
  const match = /\b(20\d{2})\b/.exec(fileName)
  if (!match) {
    throw new RetailerFormatError(
      `${LABEL}: couldn't find a calendar year in the filename "${fileName}" — the file's own "week01".."week52" labels ` +
        `aren't tied to a year anywhere in the sheet, so this tool relies on the filename containing one (e.g. "... 2026 ...").`,
    )
  }
  return Number(match[1])
}

function parseRevenueByStoreWeek(grid: unknown[][], year: number): Map<string, number> {
  const headerRowIndex = findHeaderRowIndex(grid, ['TY', 'LY'])
  if (headerRowIndex === -1) {
    throw new RetailerFormatError(`${LABEL}: "${REVENUE_SHEET}" doesn't look right — couldn't find the "TY"/"LY" header row.`)
  }
  const headerRow = grid[headerRowIndex]
  const groupRow = grid[headerRowIndex - 1] ?? []
  const groups = discoverColumnGroups(groupRow, headerRow.length).filter((g) => g.name.toUpperCase() !== AGGREGATE_GROUP_NAME)
  if (groups.length === 0) {
    throw new RetailerFormatError(`${LABEL}: "${REVENUE_SHEET}" — couldn't find any store column groups.`)
  }
  const storeColumns = groups.map((g) => {
    const tyOffset = findSubColumnOffset(headerRow, g, 'TY')
    if (tyOffset === -1) {
      throw new RetailerFormatError(`${LABEL}: "${REVENUE_SHEET}" — store group "${g.name}" has no "TY" column.`)
    }
    return { store: titleCase(g.name), col: g.startCol + tyOffset }
  })

  const revenue = new Map<string, number>()
  // Week rows are directly below the header; the "week01".."week52" label
  // lives in column 1 (unlabeled in the sheet itself — positional).
  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const row = grid[i]
    if (!row) continue
    const weekLabel = cellToString(row[1])
    const weekMatch = /^week(\d{1,2})$/i.exec(weekLabel)
    if (!weekMatch) continue // stops naturally at the "TOTAL" row / monthly-summary block below the weekly grid

    const weekNumber = Number(weekMatch[1])
    const weekEnding = weekEndingFromIsoYearWeek(year, weekNumber)

    const monthToken = cellToString(row[0]).toUpperCase()
    if (monthToken && monthToken in MONTH_TOKEN_TO_MONTH_INDEX0) {
      const expectedMonth = MONTH_TOKEN_TO_MONTH_INDEX0[monthToken]
      const monday = mondayOfWeek(weekEnding)
      if (monday.getUTCMonth() !== expectedMonth && weekEnding.getUTCMonth() !== expectedMonth) {
        throw new RetailerFormatError(
          `${LABEL}: week${weekMatch[1]} is labeled "${monthToken}" but derived as ${weekEnding.toISOString().slice(0, 10)} — ` +
            `the calendar year (${year}, read from the filename) is probably wrong for this file.`,
        )
      }
    }

    for (const { store, col } of storeColumns) {
      const raw = cellToString(row[col])
      const amount = raw === '' ? 0 : parseCurrencyToNumber(raw)
      if (amount === null) {
        throw new RetailerFormatError(`${LABEL} row ${i + 1} (${store}): expected a number for revenue, got "${raw}"`)
      }
      revenue.set(`${store}|${weekNumber}`, amount)
    }
  }
  return revenue
}

function parseUnitsByStoreWeek(grid: unknown[][]): Map<string, number> {
  // No fixed header row here — every column in a week's block repeats
  // that week's own label (see groupRunsByLabel), and the store names sit
  // one row below that.
  const weekLabelRowIndex = grid.findIndex((r) => r && cellToString(r[2]).match(/^week\d{1,2}$/i))
  if (weekLabelRowIndex === -1) {
    throw new RetailerFormatError(`${LABEL}: "${UNITS_SHEET}" doesn't look right — couldn't find the "week01" row.`)
  }
  const weekGroupRow = grid[weekLabelRowIndex]
  const storeNameRow = grid[weekLabelRowIndex + 1] ?? []
  const weekGroups = groupRunsByLabel(weekGroupRow)

  const units = new Map<string, number>()
  const productRows = grid.slice(weekLabelRowIndex + 2).filter((r) => r && cellToString(r[1]) !== '')

  for (const weekGroup of weekGroups) {
    const weekMatch = /^week(\d{1,2})$/i.exec(weekGroup.name)
    if (!weekMatch) continue
    const weekNumber = Number(weekMatch[1])

    const storeCols = groupRunsByLabel(storeNameRow.slice(weekGroup.startCol, weekGroup.startCol + weekGroup.width)).filter(
      (g) => g.name.toUpperCase() !== AGGREGATE_GROUP_NAME,
    )

    for (const storeCol of storeCols) {
      const absoluteCol = weekGroup.startCol + storeCol.startCol
      const store = titleCase(storeCol.name)
      let sum = 0
      for (const productRow of productRows) {
        const raw = cellToString(productRow[absoluteCol])
        const value = raw === '' ? 0 : parseIntegerUnits(raw)
        if (value === null) {
          throw new RetailerFormatError(`${LABEL}: "${UNITS_SHEET}" — expected a whole number for units, got "${raw}"`)
        }
        sum += value
      }
      units.set(`${store}|${weekNumber}`, sum)
    }
  }
  return units
}

export const selfridges: RetailerParser = {
  key: 'selfridges',
  label: LABEL,
  skuLevel: SKU_LEVEL,

  detect(sheet: RawSheet): number {
    if (!sheet.sheets) return 0
    return sheet.sheets[REVENUE_SHEET] && sheet.sheets[UNITS_SHEET] ? 1 : 0
  },

  parse(sheet: RawSheet): ParsedRow[] {
    if (!sheet.sheets) {
      throw new RetailerFormatError(`Expected a multi-tab ${LABEL} workbook (.xlsx) with "${REVENUE_SHEET}"/"${UNITS_SHEET}" tabs — got a single-sheet/CSV file.`)
    }
    const revenueGrid = sheet.sheets[REVENUE_SHEET]
    const unitsGrid = sheet.sheets[UNITS_SHEET]
    if (!revenueGrid || !unitsGrid) {
      throw new RetailerFormatError(
        `Couldn't find "${REVENUE_SHEET}"/"${UNITS_SHEET}" tabs in this workbook. Tabs found: ${Object.keys(sheet.sheets).join(', ')}`,
      )
    }

    const year = extractYearFromFileName(sheet.fileName)
    const revenue = parseRevenueByStoreWeek(revenueGrid, year)
    const units = parseUnitsByStoreWeek(unitsGrid)

    const normalized: ParsedRow[] = []
    for (const [key, amount] of revenue) {
      const [store, weekStr] = key.split('|')
      const weekNumber = Number(weekStr)
      const weekEnding = weekEndingFromIsoYearWeek(year, weekNumber)

      const salesUnits = units.get(key)
      if (salesUnits === undefined) {
        throw new RetailerFormatError(
          `${LABEL}: no units figure found for "${store}", week${weekNumber} — "${REVENUE_SHEET}" and "${UNITS_SHEET}" don't line up for this store/week.`,
        )
      }

      const isOnline = store === 'Online'
      let region = 'Online'
      if (!isOnline) {
        const mapped = REGION_BY_STORE[store]
        if (!mapped) {
          throw new RetailerFormatError(`${LABEL}: unrecognized store "${store}" — no region mapping for it. Add it to REGION_BY_STORE.`)
        }
        region = mapped
      }

      normalized.push({
        RETAILER: LABEL,
        BRAND: 'UKLASH',
        PRODUCT_TITLE: null,
        ...deriveDateFields(weekEnding),
        SALES_AMOUNT: roundToPence(amount),
        SALES_UNITS: salesUnits,
        CHANNEL: isOnline ? 'Online' : 'Store',
        STORE_LOCATION: isOnline ? 'Online' : store,
        REGION: region,
        PERIOD: 'WEEK',
      })
    }

    return normalized
  },
}
