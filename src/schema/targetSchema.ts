// The normalized output schema every retailer parser must produce.
// See project spec: one row per (product/store, week) sell-through record.

// "Unknown" added beyond the original spec: some retailers (confirmed so
// far: Anthropologie) give no channel signal at all — one blended total
// per product, no Store/Web split, nothing to infer it from. Forcing a
// guess into "Online" or "Store" would be less honest than saying we
// don't know — see README "Open provisional decisions".
export type Channel = 'Online' | 'Store' | 'Unknown'

export interface NormalizedRow {
  RETAILER: string
  // Added beyond the original spec: some retailer exports (confirmed so
  // far: ASOS, Boots) mix UKLASH's own product lines with other brands
  // sold under the same reporting category (e.g. "Groa"). BRAND
  // distinguishes them without dropping either from the output. Defaults
  // to "UKLASH" for retailers with no multi-brand signal in their source
  // data.
  BRAND: string
  PRODUCT_TITLE: string | null
  WEEK_ENDING: string // DD/MM/YYYY, the Sunday closing the week
  CALENDAR_YYYY_WW: string
  CALENDAR_YYYY_MM: string
  FINANCIAL_YYYY_WW: string
  FINANCIAL_YYYY_MM: string
  SALES_AMOUNT: number // plain float, e.g. 76.00 or -190.00 — no currency symbol, loads straight into a Snowflake FLOAT column
  SALES_UNITS: number
  CHANNEL: Channel
  STORE_LOCATION: string
  REGION: string
  PERIOD: string
  // Added beyond the original spec: a stable per-row identifier so
  // Snowflake loads can MERGE (upsert) on it instead of appending —
  // uploading the same retailer file twice (or a rolling window that
  // re-sends old weeks alongside new ones, which most retailers here do)
  // then updates/no-ops existing rows rather than duplicating them. See
  // `src/lib/rowKey.ts` and the README section on avoiding duplicate loads.
  ROW_KEY: string
}

/** What a retailer's parse() actually produces — ROW_KEY is computed centrally afterward, see `src/lib/rowKey.ts`. */
export type ParsedRow = Omit<NormalizedRow, 'ROW_KEY'>

export const NORMALIZED_COLUMNS: (keyof NormalizedRow)[] = [
  'RETAILER',
  'BRAND',
  'PRODUCT_TITLE',
  'WEEK_ENDING',
  'CALENDAR_YYYY_WW',
  'CALENDAR_YYYY_MM',
  'FINANCIAL_YYYY_WW',
  'FINANCIAL_YYYY_MM',
  'SALES_AMOUNT',
  'SALES_UNITS',
  'CHANNEL',
  'STORE_LOCATION',
  'REGION',
  'PERIOD',
  'ROW_KEY',
]
