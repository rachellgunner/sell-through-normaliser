import { useRef, useState, type DragEvent } from 'react'

interface UploadZoneProps {
  onFileSelected: (file: File) => void
  fileName: string | null
}

export function UploadZone({ onFileSelected, fileName }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files[0]
    if (file) onFileSelected(file)
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
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFileSelected(file)
        }}
      />
      {fileName ? (
        <p>
          <strong>{fileName}</strong> selected — click or drop to replace
        </p>
      ) : (
        <p>Drag a CSV/XLSX file here, or click to browse</p>
      )}
    </div>
  )
}
