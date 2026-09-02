import { NORMALIZED_COLUMNS, type NormalizedRow } from '../schema/targetSchema'

const PREVIEW_ROW_LIMIT = 50

export function PreviewTable({ rows }: { rows: NormalizedRow[] }) {
  const preview = rows.slice(0, PREVIEW_ROW_LIMIT)

  return (
    <div className="preview-table-wrap">
      <table className="preview-table">
        <thead>
          <tr>
            {NORMALIZED_COLUMNS.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.map((row, i) => (
            <tr key={i}>
              {NORMALIZED_COLUMNS.map((col) => (
                <td key={col}>{row[col] === null ? <em>null</em> : String(row[col])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > PREVIEW_ROW_LIMIT && (
        <p className="preview-note">
          Showing first {PREVIEW_ROW_LIMIT} of {rows.length} rows. The full dataset is included in the download.
        </p>
      )}
    </div>
  )
}
