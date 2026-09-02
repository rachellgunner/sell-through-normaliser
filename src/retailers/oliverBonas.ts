import { notYetConfigured } from './types'

// TODO: replace with real column mapping once a sample Oliver Bonas export
// is available (not currently sent consistently). The original spec
// guessed Oliver Bonas reports store-level totals only (skuLevel: false,
// PRODUCT_TITLE null) — worth double-checking against the real file once
// it arrives, since the same guess for Boots turned out to be wrong (real
// Boots data is SKU-level).
export const oliverBonas = notYetConfigured('oliver-bonas', 'Oliver Bonas', false)
