import type { NormalizedRow } from '../schema/targetSchema'
import { parseDDMMYYYY } from './dateUtils'

export interface ValidationIssue {
  rowIndex: number // 0-based index into the normalized rows array
  field: keyof NormalizedRow | 'ROW'
  message: string
}

/**
 * Validate normalized rows against the target schema's own rules.
 * `skuLevel` tells us whether a blank PRODUCT_TITLE is expected (store-level
 * only retailers) or an error (retailers that should report per-SKU data).
 */
export function validateRows(rows: NormalizedRow[], skuLevel: boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  rows.forEach((row, rowIndex) => {
    try {
      parseDDMMYYYY(row.WEEK_ENDING)
    } catch (err) {
      issues.push({ rowIndex, field: 'WEEK_ENDING', message: (err as Error).message })
    }

    if (!Number.isInteger(row.SALES_UNITS)) {
      issues.push({
        rowIndex,
        field: 'SALES_UNITS',
        message: `SALES_UNITS must be a whole number, got "${row.SALES_UNITS}"`,
      })
    }

    if (!Number.isFinite(row.SALES_AMOUNT)) {
      issues.push({
        rowIndex,
        field: 'SALES_AMOUNT',
        message: `SALES_AMOUNT must be a number, got "${row.SALES_AMOUNT}"`,
      })
    }

    if (skuLevel && (row.PRODUCT_TITLE === null || row.PRODUCT_TITLE.trim() === '')) {
      issues.push({
        rowIndex,
        field: 'PRODUCT_TITLE',
        message: `PRODUCT_TITLE is blank, but ${row.RETAILER} is expected to report SKU-level data`,
      })
    }

    if (row.CHANNEL !== 'Online' && row.CHANNEL !== 'Store') {
      issues.push({
        rowIndex,
        field: 'CHANNEL',
        message: `CHANNEL must be "Online" or "Store", got "${row.CHANNEL}"`,
      })
    }

    if (row.CHANNEL === 'Online' && (row.STORE_LOCATION !== 'Online' || row.REGION !== 'Online')) {
      issues.push({
        rowIndex,
        field: 'STORE_LOCATION',
        message: `Online rows must have STORE_LOCATION and REGION set to "Online"`,
      })
    }
  })

  return issues
}
