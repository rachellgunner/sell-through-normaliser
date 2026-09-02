import type { ParsedRow } from '../schema/targetSchema'

/** A parsed spreadsheet, before any retailer-specific mapping is applied. */
export interface RawSheet {
  fileName: string
  /** Header cells, assuming row 1 is the header row (true for most retailers). */
  headers: string[]
  /** Data rows keyed by row-1 header text — convenient default, wrong for files with title rows above the real header. */
  rows: Record<string, unknown>[]
  /**
   * The full first/only sheet as a raw grid (row 0 = first row of the
   * file), for retailers whose real header row isn't row 1 (e.g. title
   * rows above it). Use `findHeaderRowIndex` / `gridRowsFromHeader` from
   * `lib/rawSheet` to locate the real header row and key data rows off it.
   */
  rawGrid: unknown[][]
  /**
   * For multi-tab XLSX workbooks, every sheet as a raw grid, keyed by
   * sheet/tab name (`rawGrid` above is just `sheets[sheetNames[0]]`).
   * `null` for CSV uploads, which have no concept of multiple sheets.
   * Retailers whose real data lives on a specific named tab (not
   * necessarily the first) should read from here instead of `rawGrid`.
   */
  sheets: Record<string, unknown[][]> | null
}

export class RetailerFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetailerFormatError'
  }
}

export interface RetailerParser {
  /** Stable identifier, e.g. "lookfantastic". */
  key: string
  /** Display name, used as the RETAILER column value too. */
  label: string
  /** Whether this retailer is expected to report SKU-level PRODUCT_TITLE. */
  skuLevel: boolean
  /**
   * Confidence (0-1) that `sheet` came from this retailer, based on
   * filename and/or header shape. Used to drive auto-detect suggestions —
   * never used to silently choose a retailer without user confirmation.
   */
  detect(sheet: RawSheet): number
  /**
   * Map a raw sheet into normalized rows (ROW_KEY is added afterward,
   * centrally — see `src/lib/rowKey.ts`). Must throw RetailerFormatError
   * with a clear, specific message if the sheet doesn't match this
   * retailer's expected layout — never guess or silently drop fields.
   */
  parse(sheet: RawSheet): ParsedRow[]
}

/** Parser stub for a retailer whose real column mapping hasn't been supplied yet. */
export function notYetConfigured(key: string, label: string, skuLevel: boolean): RetailerParser {
  return {
    key,
    label,
    skuLevel,
    detect: () => 0,
    parse: () => {
      throw new RetailerFormatError(
        `${label}'s column mapping hasn't been configured yet. ` +
          `Share a sample export from ${label} so the parser can be wired up.`,
      )
    },
  }
}
