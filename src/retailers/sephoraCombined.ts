import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { findHeaderRowIndex, cellToString, discoverColumnGroups, findSubColumnOffset } from '../lib/rawSheet'
import { weekEndingFromIsoYearWeek, deriveDateFields } from '../lib/dateUtils'
import { parseCurrencyToNumber, parseIntegerUnits, roundToPence } from '../lib/currency'

const LABEL = 'Sephora'
const SHEET_NAME = 'Weekly Sales By Product'

// Newer Sephora exports put online and stores in ONE sheet: "Web" and "App"
// (online), one group per store, then three subtotal groups. Distinguished
// from the older Sephora Online/Store layouts by "Item EAN Code" (they have
// "EAN Code") and the Web/App/ECOM/Retail/Total group labels.
const REQUIRED_HEADERS = ['Year Week', 'Product', 'Item EAN Code', 'Vendor Item No']
const ONLINE_GROUPS = ['Web', 'App']
const ONLINE_TOTAL_GROUP = 'ECOM'
const STORES_TOTAL_GROUP = 'Retail'
const GRAND_TOTAL_GROUP = 'Total'
const NON_STORE_GROUPS = new Set([...ONLINE_GROUPS, ONLINE_TOTAL_GROUP, STORES_TOTAL_GROUP, GRAND_TOTAL_GROUP])

/** e.g. "Manchester (Trafford)" -> "Manchester" — same rule as the older Sephora store parser. */
function deriveRegion(storeName: string): string {
  const match = /^(.*?)\s*\(/.exec(storeName)
  return match ? match[1].trim() : storeName
}

function amount(raw: string, what: string, where: string): number {
  if (raw === '') return 0 // blank means zero throughout this report
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

export const sephoraCombined: RetailerParser = {
  key: 'sephora-combined',
  label: 'Sephora (Online + Store, combined sheet)',
  skuLevel: true,

  detect(sheet: RawSheet): number {
    if (!sheet.sheets || !sheet.sheets[SHEET_NAME]) return 0
    const grid = sheet.sheets[SHEET_NAME]
    const headerRowIndex = findHeaderRowIndex(grid, REQUIRED_HEADERS)
    if (headerRowIndex === -1) return 0
    const groupNames = new Set((grid[headerRowIndex - 1] ?? []).map(cellToString))
    const hasAll = [...ONLINE_GROUPS, ONLINE_TOTAL_GROUP, STORES_TOTAL_GROUP, GRAND_TOTAL_GROUP].every((g) => groupNames.has(g))
    return hasAll ? 1 : 0
  },

  parse(sheet: RawSheet): ParsedRow[] {
    if (!sheet.sheets) {
      throw new RetailerFormatError(`Expected a multi-tab Sephora workbook (.xlsx) with a "${SHEET_NAME}" tab — got a single-sheet/CSV file.`)
    }
    const grid = sheet.sheets[SHEET_NAME]
    if (!grid) {
      throw new RetailerFormatError(`Couldn't find a "${SHEET_NAME}" tab in this workbook. Tabs found: ${Object.keys(sheet.sheets).join(', ')}`)
    }
    const headerRowIndex = findHeaderRowIndex(grid, REQUIRED_HEADERS)
    if (headerRowIndex === -1) {
      throw new RetailerFormatError(
        `"${SHEET_NAME}" doesn't look like this Sephora export — couldn't find a header row containing ${REQUIRED_HEADERS.map((h) => `"${h}"`).join(', ')}.`,
      )
    }
    const headerRow = grid[headerRowIndex] ?? []
    const groupRow = grid[headerRowIndex - 1] ?? []

    const yearWeekCol = headerRow.findIndex((c) => cellToString(c) === 'Year Week')
    const productCol = headerRow.findIndex((c) => cellToString(c) === 'Product')
    const eanCol = headerRow.findIndex((c) => cellToString(c) === 'Item EAN Code')
    const vendorItemCol = headerRow.findIndex((c) => cellToString(c) === 'Vendor Item No')

    const groups = discoverColumnGroups(groupRow, headerRow.length)
    const byName = new Map(groups.map((g) => [g.name, g]))
    for (const required of [...ONLINE_GROUPS, ONLINE_TOTAL_GROUP, STORES_TOTAL_GROUP, GRAND_TOTAL_GROUP]) {
      if (!byName.has(required)) throw new RetailerFormatError(`"${SHEET_NAME}": couldn't find the "${required}" column group — the report layout may have changed.`)
    }

    // Units/sales columns are found by scanning inside each group, not by fixed
    // offset (the first group has an extra spacer column).
    const locate = (name: string) => {
      const group = byName.get(name)!
      const u = findSubColumnOffset(headerRow, group, 'Units Sold')
      const s = findSubColumnOffset(headerRow, group, 'Sales exVAT')
      if (u === -1 || s === -1) {
        throw new RetailerFormatError(`"${SHEET_NAME}": group "${name}" is missing a "Units Sold"/"Sales exVAT" sub-column — the report layout may have changed.`)
      }
      return { unitsCol: group.startCol + u, salesCol: group.startCol + s }
    }
    const cols = new Map(groups.map((g) => [g.name, locate(g.name)]))
    const stores = groups.filter((g) => !NON_STORE_GROUPS.has(g.name))
    if (stores.length === 0) throw new RetailerFormatError(`"${SHEET_NAME}": couldn't find any per-store column groups.`)

    const dataRows = grid.slice(headerRowIndex + 1)
    const normalized: ParsedRow[] = []
    let currentYearWeek: string | null = null

    // Sephora sometimes gives two different products the same name (seen: the
    // 30ml and 50ml hair growth serums are both "UKLASH HAIR SERUM GROWTH
    // SERUM"). They can't be summed — they're different SKUs — and would
    // otherwise collide on ROW_KEY, so a clashing name gets its own item code
    // appended. Every other name is left exactly as Sephora wrote it.
    const eansByName = new Map<string, Set<string>>()
    for (const row of dataRows) {
      const name = cellToString(row?.[productCol])
      if (!name || name === 'Total') continue
      const set = eansByName.get(name) ?? eansByName.set(name, new Set()).get(name)!
      set.add(cellToString(row[eanCol]))
    }
    const titleFor = (row: unknown[], name: string): string => {
      if ((eansByName.get(name)?.size ?? 0) <= 1) return name
      const code = cellToString(row[vendorItemCol]) || `EAN ${cellToString(row[eanCol])}`
      return `${name} [${code}]`
    }

    dataRows.forEach((row, i) => {
      const rowNumber = headerRowIndex + 2 + i
      if (!row || row.every((c) => cellToString(c) === '')) return

      const yearWeekCell = cellToString(row[yearWeekCol])
      if (yearWeekCell) currentYearWeek = yearWeekCell // only populated on the first row of each week (merged cells)

      const product = cellToString(row[productCol])
      if (!product || product === 'Total') return
      const where = `${LABEL} row ${rowNumber} (${product})`

      if (!currentYearWeek) throw new RetailerFormatError(`${where}: no "Year Week" value in effect (missing from the top of the file).`)
      const match = /^(\d{4})\s+(?:wk)?(\d{1,2})$/i.exec(currentYearWeek)
      if (!match) throw new RetailerFormatError(`${where}: "Year Week" value "${currentYearWeek}" isn't in the expected "YYYY wkWW" shape.`)
      const dateFields = deriveDateFields(weekEndingFromIsoYearWeek(Number(match[1]), Number(match[2])))

      const read = (name: string) => {
        const c = cols.get(name)!
        const unitsRaw = cellToString(row[c.unitsCol])
        const salesRaw = cellToString(row[c.salesCol])
        return {
          blank: unitsRaw === '' && salesRaw === '',
          units: wholeNumber(unitsRaw, `"Units Sold" (${name})`, where),
          sales: amount(salesRaw, `"Sales exVAT" (${name})`, where),
        }
      }

      // Defensive cross-checks: the report's own subtotals must equal the
      // sum of their parts, so a column shift or layout change fails loudly
      // instead of silently mis-assigning sales to the wrong store or channel.
      const parts = (names: string[]) => names.map(read).reduce((a, p) => ({ units: a.units + p.units, sales: a.sales + p.sales }), { units: 0, sales: 0 })
      const checks: [string, string[], string][] = [
        ['Web + App', ONLINE_GROUPS, ONLINE_TOTAL_GROUP],
        ['all stores', stores.map((s) => s.name), STORES_TOTAL_GROUP],
        ['ECOM + Retail', [ONLINE_TOTAL_GROUP, STORES_TOTAL_GROUP], GRAND_TOTAL_GROUP],
      ]
      for (const [label, names, totalName] of checks) {
        const sum = parts(names)
        const total = read(totalName)
        if (sum.units !== total.units || Math.abs(sum.sales - total.sales) > 0.05) {
          throw new RetailerFormatError(
            `${where}: ${label} adds up to ${sum.units} units / ${sum.sales.toFixed(2)} sales, but the "${totalName}" column says ${total.units} / ${total.sales.toFixed(2)} — the report layout may have changed.`,
          )
        }
      }

      const emit = (r: { blank: boolean; units: number; sales: number }, channel: 'Online' | 'Store', location: string, region: string) => {
        if (r.blank) return
        normalized.push({
          RETAILER: LABEL,
          BRAND: 'UKLASH',
          PRODUCT_TITLE: titleFor(row, product),
          ...dateFields,
          SALES_AMOUNT: roundToPence(r.sales),
          SALES_UNITS: r.units,
          CHANNEL: channel,
          STORE_LOCATION: location,
          REGION: region,
          PERIOD: 'WEEK',
        })
      }

      // Online = ECOM (Web + App combined), the same single "Online" line the
      // older Sephora Online report gave. Stores = one row per store.
      emit(read(ONLINE_TOTAL_GROUP), 'Online', 'Online', 'Online')
      for (const store of stores) emit(read(store.name), 'Store', store.name, deriveRegion(store.name))
    })

    return normalized
  },
}
