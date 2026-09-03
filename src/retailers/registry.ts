import type { RawSheet, RetailerParser } from './types'
import { lookfantastic } from './lookfantastic'
import { asos } from './asos'
import { sephoraOnline } from './sephoraOnline'
import { sephoraStore } from './sephoraStore'
import { boots } from './boots'
import { oliverBonas } from './oliverBonas'
import { johnLewis } from './johnLewis'
import { selfridges } from './selfridges'
import { anthropologie } from './anthropologie'

// Add each new retailer parser here once its mapping is known.
// All 8 retailers are now identified. Anthropologie isn't being sent
// consistently yet, so it's still a placeholder. Sephora is split into
// two entries (Online / Store) since it sends two structurally
// different files.
export const RETAILER_PARSERS: RetailerParser[] = [
  lookfantastic,
  asos,
  sephoraOnline,
  sephoraStore,
  boots,
  oliverBonas,
  johnLewis,
  selfridges,
  anthropologie,
]

export function getParser(key: string): RetailerParser | undefined {
  return RETAILER_PARSERS.find((p) => p.key === key)
}

/** Best-guess retailer for a freshly uploaded sheet, or null if nothing is confident. */
export function autoDetect(sheet: RawSheet): { parser: RetailerParser; confidence: number } | null {
  let best: { parser: RetailerParser; confidence: number } | null = null
  for (const parser of RETAILER_PARSERS) {
    const confidence = parser.detect(sheet)
    if (confidence > 0 && (!best || confidence > best.confidence)) {
      best = { parser, confidence }
    }
  }
  // Require reasonable confidence before suggesting anything — the user
  // always confirms or overrides regardless.
  return best && best.confidence >= 0.5 ? best : null
}
