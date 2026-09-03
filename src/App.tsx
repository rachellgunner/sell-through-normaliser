import { useMemo, useState } from 'react'
import { UploadZone } from './components/UploadZone'
import { RetailerSelect } from './components/RetailerSelect'
import { PreviewTable } from './components/PreviewTable'
import { ValidationErrors } from './components/ValidationErrors'
import { DownloadButton } from './components/DownloadButton'
import { BatchPanel, type BatchItem } from './components/BatchPanel'
import { RETAILER_PARSERS, autoDetect, getParser } from './retailers/registry'
import { RetailerFormatError, type RawSheet } from './retailers/types'
import { parseUploadedFile } from './lib/fileParse'
import { validateRows } from './lib/validate'
import { withRowKeys } from './lib/rowKey'
import type { NormalizedRow } from './schema/targetSchema'

export function App() {
  const [sheet, setSheet] = useState<RawSheet | null>(null)
  const [retailerKey, setRetailerKey] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [batch, setBatch] = useState<BatchItem[]>([])

  const suggestion = useMemo(() => (sheet ? autoDetect(sheet) : null), [sheet])

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
    setBatch((prev) => [
      ...prev.filter((item) => item.retailerKey !== parser.key), // replace any existing entry for this retailer
      { retailerKey: parser.key, retailerLabel: parser.label, fileName: sheet?.fileName ?? '', rows: normalizedRows },
    ])
  }

  function handleRemoveFromBatch(retailerKey: string) {
    setBatch((prev) => prev.filter((item) => item.retailerKey !== retailerKey))
  }

  const alreadyInBatch = parser ? batch.some((item) => item.retailerKey === parser.key) : false

  return (
    <div className="app">
      <header>
        <h1>UKLASH Sell-Through Normaliser</h1>
        <p>Upload a retailer sell-through file, confirm the retailer, and download it in the standard schema.</p>
      </header>

      <BatchPanel batch={batch} onRemove={handleRemoveFromBatch} />

      <section className="step">
        <h2>1. Upload file</h2>
        <UploadZone onFileSelected={handleFileSelected} fileName={sheet?.fileName ?? null} />
        {fileError && <p className="error-banner">{fileError}</p>}
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
          <PreviewTable rows={normalizedRows} />
        </section>
      )}
    </div>
  )
}
