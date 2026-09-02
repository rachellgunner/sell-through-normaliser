import type { RetailerParser } from '../retailers/types'

interface RetailerSelectProps {
  parsers: RetailerParser[]
  selectedKey: string | null
  onSelect: (key: string) => void
  suggestion: { parser: RetailerParser; confidence: number } | null
}

export function RetailerSelect({ parsers, selectedKey, onSelect, suggestion }: RetailerSelectProps) {
  return (
    <div className="retailer-select">
      <label htmlFor="retailer">Retailer</label>
      <select id="retailer" value={selectedKey ?? ''} onChange={(e) => onSelect(e.target.value)}>
        <option value="" disabled>
          Select a retailer…
        </option>
        {parsers.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
      </select>
      {suggestion && suggestion.parser.key !== selectedKey && (
        <p className="suggestion">
          Looks like <strong>{suggestion.parser.label}</strong> ({Math.round(suggestion.confidence * 100)}%
          confidence) —{' '}
          <button type="button" className="link-button" onClick={() => onSelect(suggestion.parser.key)}>
            use this
          </button>
        </p>
      )}
    </div>
  )
}
