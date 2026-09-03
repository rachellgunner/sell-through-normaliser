import { downloadCsv } from '../lib/csvExport'
import type { NormalizedRow } from '../schema/targetSchema'

export interface BatchItem {
  retailerKey: string
  retailerLabel: string
  fileName: string
  rows: NormalizedRow[]
}

interface BatchPanelProps {
  batch: BatchItem[]
  onRemove: (retailerKey: string) => void
}

export function BatchPanel({ batch, onRemove }: BatchPanelProps) {
  if (batch.length === 0) return null

  const totalRows = batch.reduce((sum, item) => sum + item.rows.length, 0)

  function handleDownloadCombined() {
    const allRows = batch.flatMap((item) => item.rows)
    const today = new Date().toISOString().slice(0, 10)
    downloadCsv(allRows, `combined-normalized-${today}.csv`)
  }

  return (
    <section className="step">
      <h2>Combined dataset ({batch.length} file{batch.length === 1 ? '' : 's'}, {totalRows} rows)</h2>
      <ul className="batch-list">
        {batch.map((item) => (
          <li key={item.retailerKey}>
            <span>
              <strong>{item.retailerLabel}</strong> — {item.fileName} ({item.rows.length} rows)
            </span>
            <button type="button" className="link-button" onClick={() => onRemove(item.retailerKey)}>
              remove
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="download-button" onClick={handleDownloadCombined}>
        Download combined CSV
      </button>
    </section>
  )
}
