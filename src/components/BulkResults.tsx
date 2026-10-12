import type { BulkResult } from '../lib/bulkProcess'

interface BulkResultsProps {
  results: BulkResult[]
  pendingCount: number
  onReview: (result: Extract<BulkResult, { status: 'needs-attention' }>) => void
}

export function BulkResults({ results, pendingCount, onReview }: BulkResultsProps) {
  if (results.length === 0 && pendingCount === 0) return null

  const added = results.filter((r) => r.status === 'added').length
  const attention = results.length - added

  return (
    <div className="bulk-results">
      <p className="bulk-summary">
        {pendingCount > 0
          ? `Processing… ${results.length} of ${results.length + pendingCount} done`
          : `${added} added to the combined dataset${attention > 0 ? `, ${attention} need${attention === 1 ? 's' : ''} attention` : ''}.`}
      </p>
      <ul className="bulk-list">
        {results.map((r, i) => (
          <li key={`${r.fileName}-${i}`} className={r.status === 'added' ? 'bulk-ok' : 'bulk-attention'}>
            {r.status === 'added' ? (
              <span>
                <strong>{r.fileName}</strong> — {r.parser.label}, {r.rows.length} rows added
              </span>
            ) : (
              <span>
                <strong>{r.fileName}</strong> — not added. {r.message}{' '}
                {r.sheet && (
                  <button type="button" className="link-button" onClick={() => onReview(r)}>
                    review
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
