import type { NormalizedRow } from '../schema/targetSchema'
import { downloadCsv } from '../lib/csvExport'

interface DownloadButtonProps {
  rows: NormalizedRow[]
  retailerKey: string
  disabled: boolean
}

export function DownloadButton({ rows, retailerKey, disabled }: DownloadButtonProps) {
  function handleClick() {
    const today = new Date().toISOString().slice(0, 10)
    downloadCsv(rows, `${retailerKey}-normalized-${today}.csv`)
  }

  return (
    <button type="button" className="download-button" disabled={disabled} onClick={handleClick}>
      Download CSV
    </button>
  )
}
