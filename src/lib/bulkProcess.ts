import { RETAILER_PARSERS } from '../retailers/registry'
import { RetailerFormatError, type RawSheet, type RetailerParser } from '../retailers/types'
import { parseUploadedFile } from './fileParse'
import { validateRows } from './validate'
import { withRowKeys } from './rowKey'
import type { NormalizedRow } from '../schema/targetSchema'

const MIN_CONFIDENCE = 0.5

export type BulkResult =
  | { status: 'added'; fileName: string; parser: RetailerParser; rows: NormalizedRow[] }
  | { status: 'needs-attention'; fileName: string; message: string; sheet: RawSheet | null; parser: RetailerParser | null }

/**
 * Process one dropped file end to end with no human confirmation: parse,
 * detect the retailer, normalize, validate. Anything short of a clean pass
 * is reported as "needs-attention" with the reason rather than guessed at.
 */
export async function processFileForBatch(file: File): Promise<BulkResult> {
  let sheet: RawSheet
  try {
    sheet = await parseUploadedFile(file)
  } catch (err) {
    return { status: 'needs-attention', fileName: file.name, message: (err as Error).message, sheet: null, parser: null }
  }

  const scored = RETAILER_PARSERS.map((parser) => ({ parser, confidence: parser.detect(sheet) }))
    .filter((s) => s.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
  const best = scored[0]

  if (!best || best.confidence < MIN_CONFIDENCE) {
    return {
      status: 'needs-attention',
      fileName: file.name,
      message: "Couldn't tell which retailer this is. Review it on its own and pick the retailer manually.",
      sheet,
      parser: null,
    }
  }
  const runnerUp = scored[1]
  if (runnerUp && runnerUp.confidence === best.confidence) {
    return {
      status: 'needs-attention',
      fileName: file.name,
      message: `Matches ${best.parser.label} and ${runnerUp.parser.label} equally well. Review it on its own and pick the retailer manually.`,
      sheet,
      parser: null,
    }
  }

  const { parser } = best
  let rows: NormalizedRow[]
  try {
    rows = withRowKeys(parser.parse(sheet))
  } catch (err) {
    const message = err instanceof RetailerFormatError ? err.message : `Unexpected error while parsing: ${(err as Error).message}`
    return { status: 'needs-attention', fileName: file.name, message, sheet, parser }
  }

  const issues = validateRows(rows, parser.skuLevel)
  if (issues.length > 0) {
    return {
      status: 'needs-attention',
      fileName: file.name,
      message: `${issues.length} validation issue${issues.length === 1 ? '' : 's'} (first: ${issues[0].message}). Review it on its own to see them all.`,
      sheet,
      parser,
    }
  }

  return { status: 'added', fileName: file.name, parser, rows }
}
