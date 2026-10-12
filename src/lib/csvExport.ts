import Papa from 'papaparse'
import { NORMALIZED_COLUMNS, type NormalizedRow } from '../schema/targetSchema'
import { parseDDMMYYYY } from './dateUtils'

const UTF8_BOM = '﻿'

// Rows carry WEEK_ENDING as DD/MM/YYYY (what the preview shows), but the CSV
// writes it as YYYY-MM-DD so Snowflake reads it as a DATE with no format
// setting. ROW_KEY keeps the DD/MM/YYYY text inside it — it's an opaque key.
function csvCell(row: NormalizedRow, col: (typeof NORMALIZED_COLUMNS)[number]): string | number {
  if (col === 'WEEK_ENDING') return parseDDMMYYYY(row.WEEK_ENDING).toISOString().slice(0, 10)
  return row[col] ?? ''
}

export function rowsToCsv(rows: NormalizedRow[]): string {
  return Papa.unparse({
    fields: NORMALIZED_COLUMNS as string[],
    data: rows.map((row) => NORMALIZED_COLUMNS.map((col) => csvCell(row, col))),
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
