import { downloadCsv } from '../lib/csvExport'
import { combineRows } from '../lib/combine'
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
          collapsed to the one from the most recent report (the file covering the latest weeks), whatever order the
          files were added in.
          {changedValues > 0 &&
            ` ${changedValues} of those had different units/sales between files (retailers revising earlier weeks) — the most recent report's figures were kept.`}
        </p>
      )}
      <button type="button" className="download-button" onClick={handleDownloadCombined}>
        Download combined CSV
      </button>
    </section>
  )
}
