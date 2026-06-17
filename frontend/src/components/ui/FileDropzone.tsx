import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileText, X } from 'lucide-react'
import { clsx } from 'clsx'

interface FileDropzoneProps {
  onFiles: (files: File[]) => void
  accept?: Record<string, string[]>
  multiple?: boolean
  files?: File[]
  onRemove?: (index: number) => void
  label?: string
  hint?: string
  className?: string
  compact?: boolean
}

export function FileDropzone({
  onFiles,
  accept,
  multiple = false,
  files = [],
  onRemove,
  label = 'Drop files here or click to browse',
  hint = 'PDF, TXT, or MD files supported',
  className,
  compact = false,
}: FileDropzoneProps) {
  const onDrop = useCallback(
    (accepted: File[]) => { onFiles(accepted) },
    [onFiles]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: accept ?? {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
    },
    multiple,
  })

  return (
    <div className={clsx('space-y-3', className)}>
      <div
        {...getRootProps()}
        className={clsx(
          'border border-dashed text-center cursor-pointer transition-all duration-200',
          compact ? 'p-3' : 'p-10',
          isDragActive
            ? 'border-gold bg-gold/5'
            : 'border-white/15 hover:border-white/30'
        )}
      >
        <input {...getInputProps()} />
        <Upload className={clsx('mx-auto text-white/20', compact ? 'mb-1.5' : 'mb-4')} size={compact ? 16 : 32} strokeWidth={1} />
        <p className={clsx('font-light text-white/50', compact ? 'text-xs' : 'text-sm')}>{label}</p>
        <p className={clsx('text-white/25 tracking-wide', compact ? 'text-[10px] mt-1' : 'text-xs mt-1.5')}>{hint}</p>
      </div>
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((file, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 border border-white/[0.06]" style={{ background: 'var(--surface-card)' }}>
              <FileText size={14} className="text-gold flex-shrink-0" strokeWidth={1.5} />
              <span className="text-sm font-light text-white/60 flex-1 truncate">{file.name}</span>
              <span className="text-xs text-white/25">{(file.size / 1024).toFixed(1)} KB</span>
              {onRemove && (
                <button onClick={() => onRemove(i)} className="text-white/25 hover:text-red-400 transition-colors">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
