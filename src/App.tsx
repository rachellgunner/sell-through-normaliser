import { useMemo, useState } from 'react'
import { UploadZone } from './components/UploadZone'
import { RetailerSelect } from './components/RetailerSelect'
import { PreviewTable } from './components/PreviewTable'
import { ValidationErrors } from './components/ValidationErrors'
import { DownloadButton } from './components/DownloadButton'
import { BatchPanel, batchItemId, type BatchItem } from './components/BatchPanel'
import { BulkResults } from './components/BulkResults'
import { RETAILER_PARSERS, autoDetect, getParser } from './retailers/registry'
import { RetailerFormatError, type RawSheet } from './retailers/types'
import { parseUploadedFile } from './lib/fileParse'
import { processFileForBatch, type BulkResult } from './lib/bulkProcess'
import { validateRows } from './lib/validate'
import { withRowKeys } from './lib/rowKey'
import type { NormalizedRow } from './schema/targetSchema'

export function App() {
  const [sheet, setSheet] = useState<RawSheet | null>(null)
  const [retailerKey, setRetailerKey] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [batch, setBatch] = useState<BatchItem[]>([])
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([])
  const [bulkPending, setBulkPending] = useState(0)

  const suggestion = useMemo(() => (sheet ? autoDetect(sheet) : null), [sheet])

  function addToBatch(item: BatchItem) {
    setBatch((prev) => [...prev.filter((existing) => existing.id !== item.id), item]) // same file re-added replaces itself
  }

  async function handleFilesSelected(files: File[]) {
    if (files.length === 1) {
      setBulkResults([])
      await handleFileSelected(files[0])
      return
    }
    setSheet(null)
    setRetailerKey(null)
    setFileError(null)
    setBulkResults([])
    setBulkPending(files.length)
    // Oldest file first, so when files overlap (retailers re-send and revise
    // earlier weeks) the newest file's figures are the ones that win.
    const oldestFirst = [...files].sort((a, b) => a.lastModified - b.lastModified)
    for (const file of oldestFirst) {
      const result = await processFileForBatch(file)
      if (result.status === 'added') {
        addToBatch({
          id: batchItemId(result.parser.key, result.fileName),
          retailerKey: result.parser.key,
          retailerLabel: result.parser.label,
          fileName: result.fileName,
          rows: result.rows,
        })
      }
      setBulkResults((prev) => [...prev, result])
      setBulkPending((n) => n - 1)
    }
  }

  function handleReviewFromBulk(result: Extract<BulkResult, { status: 'needs-attention' }>) {
    if (!result.sheet) return
    setFileError(null)
    setSheet(result.sheet)
    setRetailerKey(result.parser?.key ?? null)
  }

  async function handleFileSelected(file: File) {
    setFileError(null)
    try {
      const parsed = await parseUploadedFile(file)
      setSheet(parsed)
      const detected = autoDetect(parsed)
      if (detected) setRetailerKey(detected.parser.key)
    } catch (err) {
      setSheet(null)
      setFileError((err as Error).message)
    }
  }

  const parser = retailerKey ? getParser(retailerKey) : undefined

  const { normalizedRows, parseError } = useMemo(() => {
    if (!sheet || !parser) return { normalizedRows: null as NormalizedRow[] | null, parseError: null as string | null }
    try {
      return { normalizedRows: withRowKeys(parser.parse(sheet)), parseError: null }
    } catch (err) {
      if (err instanceof RetailerFormatError) {
        return { normalizedRows: null, parseError: err.message }
      }
      return { normalizedRows: null, parseError: `Unexpected error while parsing: ${(err as Error).message}` }
    }
  }, [sheet, parser])

  const validationIssues = useMemo(
    () => (normalizedRows && parser ? validateRows(normalizedRows, parser.skuLevel) : []),
    [normalizedRows, parser],
  )

  function handleAddToBatch() {
    if (!normalizedRows || !parser) return
    const fileName = sheet?.fileName ?? ''
    addToBatch({ id: batchItemId(parser.key, fileName), retailerKey: parser.key, retailerLabel: parser.label, fileName, rows: normalizedRows })
  }

  function handleRemoveFromBatch(id: string) {
    setBatch((prev) => prev.filter((item) => item.id !== id))
  }

  const alreadyInBatch = parser && sheet ? batch.some((item) => item.id === batchItemId(parser.key, sheet.fileName)) : false

  return (
    <div className="app">
      <header>
        <h1>UKLASH Sell-Through Normaliser</h1>
        <p>Upload a retailer sell-through file, confirm the retailer, and download it in the standard schema.</p>
      </header>

      <section className="step">
        <h2>1. Upload file</h2>
        <UploadZone onFilesSelected={handleFilesSelected} fileName={sheet?.fileName ?? null} />
        {fileError && <p className="error-banner">{fileError}</p>}
        <BulkResults results={bulkResults} pendingCount={bulkPending} onReview={handleReviewFromBulk} />

      </section>

      {sheet && (
        <section className="step">
          <h2>2. Confirm retailer</h2>
          <RetailerSelect
            parsers={RETAILER_PARSERS}
            selectedKey={retailerKey}
            onSelect={setRetailerKey}
            suggestion={suggestion}
          />
        </section>
      )}

      {parseError && (
        <section className="step">
          <p className="error-banner">{parseError}</p>
        </section>
      )}

      {normalizedRows && parser && (
        <section className="step">
          <h2>3. Review and download</h2>
          <ValidationErrors issues={validationIssues} />
          <div className="download-actions">
            <DownloadButton rows={normalizedRows} retailerKey={parser.key} disabled={validationIssues.length > 0} />
            <button
              type="button"
              className="add-to-batch-button"
              onClick={handleAddToBatch}
              disabled={validationIssues.length > 0}
            >
              {alreadyInBatch ? 'Update in combined dataset' : 'Add to combined dataset'}
            </button>
          </div>
          <p className="batch-hint">
            Uploading multiple retailers this week? Add each one to the combined dataset below, then upload the next
            file here — the combined download stays available until you refresh the page.
          </p>
          <PreviewTable rows={normalizedRows} />
        </section>
      )}

      <BatchPanel batch={batch} onRemove={handleRemoveFromBatch} />
    </div>
  )
}
