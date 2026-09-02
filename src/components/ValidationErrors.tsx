import type { ValidationIssue } from '../lib/validate'

const SHOWN_LIMIT = 25

export function ValidationErrors({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return null

  const shown = issues.slice(0, SHOWN_LIMIT)

  return (
    <div className="validation-errors">
      <h2>
        {issues.length} validation issue{issues.length === 1 ? '' : 's'} found — fix the source file and re-upload
        before downloading
      </h2>
      <ul>
        {shown.map((issue, i) => (
          <li key={i}>
            Row {issue.rowIndex + 1}, <strong>{issue.field}</strong>: {issue.message}
          </li>
        ))}
      </ul>
      {issues.length > SHOWN_LIMIT && <p>…and {issues.length - SHOWN_LIMIT} more.</p>}
    </div>
  )
}
