import type { NormalizedRow } from '../schema/targetSchema'

function weekKey(weekEnding: string): number {
  const [d, m, y] = weekEnding.split('/').map(Number)
  return y * 10000 + m * 100 + d
}

function latestWeek(rows: NormalizedRow[]): number {
  let latest = 0
  for (const row of rows) latest = Math.max(latest, weekKey(row.WEEK_ENDING))
  return latest
}

/**
 * Merge every file's rows into one dataset, one row per ROW_KEY.
 *
 * When files overlap (retailers re-send and revise earlier weeks), the file
 * that reports the latest week wins — i.e. the most recent report — no matter
 * what order the files were added in. Files with the same latest week fall
 * back to the order they were added (later wins). Without this, dropping
 * files newest-first would let stale, part-finished figures overwrite the
 * final ones.
 */
export function combineRows(items: { rows: NormalizedRow[] }[]): {
  rows: NormalizedRow[]
  duplicatesRemoved: number
  changedValues: number
} {
  const oldestFirst = items
    .map((item, order) => ({ item, order, latest: latestWeek(item.rows) }))
    .sort((a, b) => a.latest - b.latest || a.order - b.order)

  const byKey = new Map<string, NormalizedRow>()
  let total = 0
  let changedValues = 0
  for (const { item } of oldestFirst) {
    for (const row of item.rows) {
      total++
      const previous = byKey.get(row.ROW_KEY)
      if (previous && (previous.SALES_UNITS !== row.SALES_UNITS || Math.abs(previous.SALES_AMOUNT - row.SALES_AMOUNT) > 0.005)) {
        changedValues++
      }
      byKey.delete(row.ROW_KEY)
      byKey.set(row.ROW_KEY, row)
    }
  }
  return { rows: Array.from(byKey.values()), duplicatesRemoved: total - byKey.size, changedValues }
}
