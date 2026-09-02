import type { RawSheet, RetailerParser } from './types'
import { RetailerFormatError } from './types'
import type { ParsedRow } from '../schema/targetSchema'
import { findHeaderRowIndex, cellToString, groupRunsByLabel } from '../lib/rawSheet'
import { parseDDMMYYYY, weekEndingFromSaturdayClose, deriveDateFields } from '../lib/dateUtils'
import { parseCurrencyToNumber, roundToPence } from '../lib/currency'

const LABEL = 'Boots'
const AMOUNT_GROUP_LABEL = 'Total Sales Amount 52 Weeks Rolling'
const UNITS_GROUP_LABEL = 'Total Sales Volume Units 52 Weeks Rolling'

function parseProductCell(raw: string): string {
  // e.g. "  7493320 - Uklash Lash & Brow Serum 1ml Set" -> "Uklash Lash & Brow Serum 1ml Set"
  const match = /^\d+\s*-\s*(.+)$/.exec(raw.trim())
  return match ? match[1].trim() : raw.trim()
}

/** e.g. "groa Brow Serum" -> "GROA"; everything else (UKLASH/UKBROW/UKHAIR) -> "UKLASH". */
function deriveBrand(productName: string): string {
  return productName.trim().toLowerCase().startsWith('groa') ? 'GROA' : 'UKLASH'
}

export const boots: RetailerParser = {
  key: 'boots',
  label: LABEL,
  // The original spec guessed Boots would be store-totals-only like
  // Oliver Bonas — the real export is actually SKU-level.
  skuLevel: true,

  detect(sheet: RawSheet): number {
    return findHeaderRowIndex(sheet.rawGrid, [AMOUNT_GROUP_LABEL, UNITS_GROUP_LABEL]) !== -1 ? 1 : 0
  },

  parse(sheet: RawSheet): ParsedRow[] {
    const grid = sheet.rawGrid
    const groupRowIndex = findHeaderRowIndex(grid, [AMOUNT_GROUP_LABEL, UNITS_GROUP_LABEL])
    if (groupRowIndex === -1) {
      throw new RetailerFormatError(`This doesn't look like a ${LABEL} export — couldn't find "${AMOUNT_GROUP_LABEL}"/"${UNITS_GROUP_LABEL}" columns.`)
    }
    const groupRow = grid[groupRowIndex]
    const dateRow = grid[groupRowIndex + 1] ?? []

    const groups = groupRunsByLabel(groupRow)
    const amountGroup = groups.find((g) => g.name === AMOUNT_GROUP_LABEL)
    const unitsGroup = groups.find((g) => g.name === UNITS_GROUP_LABEL)
    if (!amountGroup || !unitsGroup) {
      throw new RetailerFormatError(`${LABEL}: couldn't locate both the sales-amount and units column blocks.`)
    }
    if (amountGroup.width !== unitsGroup.width) {
      throw new RetailerFormatError(
        `${LABEL}: sales-amount block has ${amountGroup.width} week columns but units block has ${unitsGroup.width} — expected them to match.`,
      )
    }

    // Both blocks repeat the same 52 dates in the same order (confirmed
    // against a real export) — read the week dates once, from the amount block.
    const weeks = Array.from({ length: amountGroup.width }, (_, i) => {
      const dateCell = cellToString(dateRow[amountGroup.startCol + i])
      const saturdayClose = parseDDMMYYYY(dateCell)
      if (saturdayClose.getUTCDay() !== 6) {
        throw new RetailerFormatError(
          `${LABEL}: expected "${dateCell}" to be a Saturday (Boots reports the closing Saturday of a Sunday-Saturday week) — the week convention may have changed.`,
        )
      }
      return {
        weekEnding: weekEndingFromSaturdayClose(saturdayClose),
        amountCol: amountGroup.startCol + i,
        unitsCol: unitsGroup.startCol + i,
      }
    })

    const normalized: ParsedRow[] = []
    const productRows = grid.slice(groupRowIndex + 2)

    productRows.forEach((row, i) => {
      const rowNumber = groupRowIndex + 3 + i
      const productCell = cellToString(row?.[0])
      if (!productCell) return // trailing blank row

      const productTitle = parseProductCell(productCell)
      const brand = deriveBrand(productTitle)

      for (const week of weeks) {
        const amountRaw = cellToString(row[week.amountCol])
        const unitsRaw = cellToString(row[week.unitsCol])
        if (amountRaw === '' && unitsRaw === '') continue // no activity that week — skip rather than emit an all-zero row

        const amount = amountRaw === '' ? 0 : parseCurrencyToNumber(amountRaw)
        if (amount === null) {
          throw new RetailerFormatError(`${LABEL} row ${rowNumber} (${productTitle}): expected a number for sales amount, got "${amountRaw}"`)
        }
        const units = unitsRaw === '' ? 0 : Number(unitsRaw.replace(/,/g, ''))
        if (!Number.isFinite(units) || !Number.isInteger(units)) {
          throw new RetailerFormatError(`${LABEL} row ${rowNumber} (${productTitle}): expected a whole number for units, got "${unitsRaw}"`)
        }

        normalized.push({
          RETAILER: LABEL,
          BRAND: brand,
          PRODUCT_TITLE: productTitle,
          ...deriveDateFields(week.weekEnding),
          SALES_AMOUNT: roundToPence(amount),
          SALES_UNITS: units,
          // The file has no store/channel breakdown at all (one blended
          // national total per product per week) — confirmed with the
          // business (2026-09-02) to treat this as boots.com online sales.
          CHANNEL: 'Online',
          STORE_LOCATION: 'Online',
          REGION: 'Online',
          PERIOD: 'WEEK',
        })
      }
    })

    return normalized
  },
}
