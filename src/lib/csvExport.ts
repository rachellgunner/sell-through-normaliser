import Papa from 'papaparse'
import { NORMALIZED_COLUMNS, type NormalizedRow } from '../schema/targetSchema'

const UTF8_BOM = '﻿'

export function rowsToCsv(rows: NormalizedRow[]): string {
  return Papa.unparse({
    fields: NORMALIZED_COLUMNS as string[],
    data: rows.map((row) => NORMALIZED_COLUMNS.map((col) => row[col] ?? '')),
  })
}

export function downloadCsv(rows: NormalizedRow[], fileName: string): void {
  const csv = rowsToCsv(rows)
  // Excel ignores the Blob's declared charset for local files and instead
  // sniffs the byte content, defaulting to the system ANSI codepage when
  // there's no BOM — which garbles "£" into "Â£". A UTF-8 BOM makes Excel
  // read it correctly.
  const blob = new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
