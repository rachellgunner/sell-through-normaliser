import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { RawSheet } from '../retailers/types'
import { gridRowsFromHeader } from './rawSheet'

/**
 * Read an uploaded CSV/XLSX File into a RawSheet: the full raw grid, plus
 * a row-1-as-header convenience view. Retailers whose real header row
 * isn't row 1 (title rows above it) should use `rawGrid` directly via
 * `findHeaderRowIndex`/`gridRowsFromHeader` instead of `headers`/`rows`.
 * For multi-tab XLSX workbooks, use `sheets[tabName]` to reach a specific
 * tab instead of `rawGrid` (which is just the first tab).
 */
export async function parseUploadedFile(file: File): Promise<RawSheet> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv')) {
    return parseCsv(file)
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseXlsx(file)
  }
  throw new Error(`Unsupported file type: "${file.name}". Please upload a .csv or .xlsx file.`)
}

function toRawSheet(fileName: string, rawGrid: unknown[][], sheets: Record<string, unknown[][]> | null): RawSheet {
  const headers = (rawGrid[0] ?? []).map((cell) => (cell === null || cell === undefined ? '' : String(cell)))
  const rows = gridRowsFromHeader(rawGrid, 0)
  return { fileName, headers, rows, rawGrid, sheets }
}

async function parseCsv(file: File): Promise<RawSheet> {
  const text = await file.text()
  const result = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: true,
  })
  if (result.errors.length > 0) {
    const first = result.errors[0]
    throw new Error(`Could not parse "${file.name}" as CSV: ${first.message} (row ${first.row ?? '?'})`)
  }
  return toRawSheet(file.name, result.data, null)
}

async function parseXlsx(file: File): Promise<RawSheet> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    throw new Error(`"${file.name}" doesn't contain any sheets.`)
  }
  const sheets: Record<string, unknown[][]> = {}
  for (const sheetName of workbook.SheetNames) {
    sheets[sheetName] = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: false,
    })
  }
  return toRawSheet(file.name, sheets[firstSheetName], sheets)
}
