export function cellToString(cell: unknown): string {
  return cell === null || cell === undefined ? '' : String(cell).trim()
}

export interface ColumnGroup {
  name: string
  startCol: number
  width: number
}

/**
 * For reports with a "group label" row above the real header row (e.g. one
 * column-group per store, each internally repeating headers like "Units
 * Sold"/"Sales Ex Vat"): find every group's name, start column, and width,
 * by locating each non-blank cell in `groupRow`. A group's width is
 * whatever's between it and the next group's start (or the end of the
 * row for the last group) — don't assume a fixed width, some real exports
 * have an inconsistent spacer column in one group but not others.
 */
export function discoverColumnGroups(groupRow: unknown[], totalCols: number): ColumnGroup[] {
  const starts: { name: string; col: number }[] = []
  groupRow.forEach((cell, idx) => {
    const s = cellToString(cell)
    if (s) starts.push({ name: s, col: idx })
  })
  return starts.map((g, i) => ({
    name: g.name,
    startCol: g.col,
    width: (i + 1 < starts.length ? starts[i + 1].col : totalCols) - g.col,
  }))
}

/**
 * Like `discoverColumnGroups`, but for rows where a group's label repeats
 * across every column in its block (rather than appearing once at the
 * start, with blanks filling the rest) — group boundaries are wherever
 * the label text changes, not wherever a blank cell appears.
 */
export function groupRunsByLabel(row: unknown[]): ColumnGroup[] {
  const groups: ColumnGroup[] = []
  let current: { name: string; startCol: number } | null = null
  row.forEach((cell, idx) => {
    const text = cellToString(cell)
    if (text && current && text === current.name) return // continuing the same run
    if (current) groups.push({ name: current.name, startCol: current.startCol, width: idx - current.startCol })
    current = text ? { name: text, startCol: idx } : null
  })
  if (current) {
    const last = current as { name: string; startCol: number }
    groups.push({ name: last.name, startCol: last.startCol, width: row.length - last.startCol })
  }
  return groups
}

/** Find a sub-header's column offset (0-based, relative to `group.startCol`) within a column group. Returns -1 if not found. */
export function findSubColumnOffset(headerRow: unknown[], group: ColumnGroup, subHeaderLabel: string): number {
  return headerRow.slice(group.startCol, group.startCol + group.width).findIndex((c) => cellToString(c) === subHeaderLabel)
}

/**
 * Find the row (0-based) in a raw grid whose cells contain every one of
 * `requiredHeaders` (exact match after trimming). Returns -1 if not found.
 * Use this instead of assuming row 0 is the header row — several retailer
 * exports have title/blank rows above the real header.
 */
export function findHeaderRowIndex(rawGrid: unknown[][], requiredHeaders: string[]): number {
  for (let i = 0; i < rawGrid.length; i++) {
    const cells = (rawGrid[i] ?? []).map(cellToString)
    if (requiredHeaders.every((h) => cells.includes(h))) return i
  }
  return -1
}

/**
 * Key every non-blank row below `headerRowIndex` by the header text in
 * that row. Rows that are entirely blank are skipped.
 */
export function gridRowsFromHeader(rawGrid: unknown[][], headerRowIndex: number): Record<string, unknown>[] {
  const headerCells = (rawGrid[headerRowIndex] ?? []).map(cellToString)
  return rawGrid
    .slice(headerRowIndex + 1)
    .filter((row) => (row ?? []).some((cell) => cellToString(cell) !== ''))
    .map((row) => {
      const obj: Record<string, unknown> = {}
      headerCells.forEach((header, index) => {
        if (header) obj[header] = row[index] ?? null
      })
      return obj
    })
}
