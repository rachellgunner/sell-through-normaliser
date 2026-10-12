import { downloadCsv } from '../lib/csvExport'
import type { NormalizedRow } from '../schema/targetSchema'

export interface BatchItem {
  id: string // retailerKey + file name — one entry per file, so e.g. several weekly ASOS files can coexist
  retailerKey: string
  retailerLabel: string
  fileName: string
  rows: NormalizedRow[]
}

export function batchItemId(retailerKey: string, fileName: string): string {
  return `${retailerKey}::${fileName}`
}

/** Concatenate every file's rows, keeping only the latest-added row per ROW_KEY (overlapping rolling windows would otherwise duplicate keys, which a Snowflake MERGE rejects). */
function combineRows(batch: BatchItem[]): { rows: NormalizedRow[]; duplicatesRemoved: number; changedValues: number } {
  const byKey = new Map<string, NormalizedRow>()
  let total = 0
  let changedValues = 0
  for (const item of batch) {
    for (const row of item.rows) {
      total++
      const previous = byKey.get(row.ROW_KEY)
      if (previous && (previous.SALES_UNITS !== row.SALES_UNITS || Math.abs(previous.SALES_AMOUNT - row.SALES_AMOUNT) > 0.005)) {
        changedValues++
      }
      byKey.delete(row.ROW_KEY) // re-insert so the later file's row wins and keeps its position last
      byKey.set(row.ROW_KEY, row)
    }
  }
  return { rows: Array.from(byKey.values()), duplicatesRemoved: total - byKey.size, changedValues }
}

interface BatchPanelProps {
  batch: BatchItem[]
  onRemove: (id: string) => void
}

export function BatchPanel({ batch, onRemove }: BatchPanelProps) {
  if (batch.length === 0) return null

  const { rows, duplicatesRemoved, changedValues } = combineRows(batch)

  function handleDownloadCombined() {
    const today = new Date().toISOString().slice(0, 10)
    downloadCsv(rows, `combined-normalized-${today}.csv`)
  }

  return (
    <section className="step">
      <h2>Combined dataset ({batch.length} file{batch.length === 1 ? '' : 's'}, {rows.length} rows)</h2>
      <ul className="batch-list">
        {batch.map((item) => (
          <li key={item.id}>
            <span>
              <strong>{item.retailerLabel}</strong> — {item.fileName} ({item.rows.length} rows)
            </span>
            <button type="button" className="link-button" onClick={() => onRemove(item.id)}>
              remove
            </button>
          </li>
        ))}
      </ul>
      {duplicatesRemoved > 0 && (
        <p className="batch-hint">
          {duplicatesRemoved} overlapping row{duplicatesRemoved === 1 ? '' : 's'} (same ROW_KEY in more than one file)
          collapsed to the most recently added.
          {changedValues > 0 &&
            ` ${changedValues} of those had different units/sales between files (retailers revising earlier weeks) — the newest file's figures were kept.`}
        </p>
      )}
      <button type="button" className="download-button" onClick={handleDownloadCombined}>
        Download combined CSV
      </button>
    </section>
  )
}
