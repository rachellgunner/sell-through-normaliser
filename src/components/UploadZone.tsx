import { useRef, useState, type DragEvent } from 'react'

interface UploadZoneProps {
  onFilesSelected: (files: File[]) => void
  fileName: string | null
}

export function UploadZone({ onFilesSelected, fileName }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) onFilesSelected(files)
  }

  return (
    <div
      className={`upload-zone${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) onFilesSelected(files)
          e.target.value = '' // so picking the same file again still fires onChange
        }}
      />
      {fileName ? (
        <p>
          <strong>{fileName}</strong> selected — click or drop to replace
        </p>
      ) : (
        <p>Drag one or more CSV/XLSX files here, or click to browse</p>
      )}
      <p className="upload-subhint">Drop several at once to add them all straight to the combined dataset.</p>
    </div>
  )
}
