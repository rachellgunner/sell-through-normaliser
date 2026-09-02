import { useMemo, useState } from 'react'
import { UploadZone } from './components/UploadZone'
import { RetailerSelect } from './components/RetailerSelect'
import { PreviewTable } from './components/PreviewTable'
import { ValidationErrors } from './components/ValidationErrors'
import { DownloadButton } from './components/DownloadButton'
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

  return (
    <div className="app">
      <header>
        <h1>UKLASH Sell-Through Normaliser</h1>
        <p>Upload a retailer sell-through file, confirm the retailer, and download it in the standard schema.</p>
      </header>

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
          <PreviewTable rows={normalizedRows} />
          <DownloadButton rows={normalizedRows} retailerKey={parser.key} disabled={validationIssues.length > 0} />
        </section>
      )}
    </div>
  )
}
