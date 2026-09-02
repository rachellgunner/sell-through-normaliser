import type { NormalizedRow, ParsedRow } from '../schema/targetSchema'

/**
 * Fields that together identify "the same real-world sales fact" — two
 * rows with the same key represent the same product/week/store/channel
 * combination, even if they came from different uploads or files. Used
 * as the MERGE key when loading into Snowflake, so re-uploading a
 * retailer's rolling window (most of them re-send old weeks alongside
 * new ones every time) updates/no-ops existing rows instead of
 * duplicating them.
 */
export function buildRowKey(row: ParsedRow): string {
  return [row.RETAILER, row.BRAND, row.PRODUCT_TITLE ?? '(none)', row.WEEK_ENDING, row.CHANNEL, row.STORE_LOCATION, row.PERIOD].join('|')
}

/** Add the computed ROW_KEY to every parsed row, turning ParsedRow[] into the full NormalizedRow[]. */
export function withRowKeys(rows: ParsedRow[]): NormalizedRow[] {
  return rows.map((row) => ({ ...row, ROW_KEY: buildRowKey(row) }))
}
