import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { FileDropzone } from '../ui/FileDropzone'
import { chatApi } from '../../api/chat'
import { memoryApi, type MemorySection, type MemorySectionKey } from '../../api/memory'

function errorMessage(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail
  if (detail && typeof detail === 'object') return detail.detail || detail.error || fallback
  if (typeof detail === 'string') return detail
  return fallback
}

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={clsx(
        'relative flex-shrink-0 w-9 h-5 rounded-full border transition-colors duration-200 focus:outline-none',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        checked ? 'bg-gold/25 border-gold/40' : 'bg-white/[0.06] border-white/[0.12]'
      )}
    >
      <span
        className={clsx(
          'absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full transition-transform duration-200',
          checked ? 'translate-x-4 bg-gold' : 'translate-x-0 bg-white/35'
        )}
      />
    </button>
  )
}

interface SectionCardProps {
  section: MemorySection
  onToggleSection: (key: MemorySectionKey, enabled: boolean) => void
  onToggleItem: (id: number, enabled: boolean) => void
  onDeleteItem: (id: number) => void
  onAddItem: (key: MemorySectionKey, title: string, content: string) => void
  busy: boolean
}

function SectionCard({
  section,
  onToggleSection,
  onToggleItem,
  onDeleteItem,
  onAddItem,
  busy,
}: SectionCardProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [extracting, setExtracting] = useState(false)

  async function handleFiles(files: File[]) {
    const file = files[0]
    if (!file) return
    setExtracting(true)
    try {
      const doc = await chatApi.extractDocument(file)
      if (!doc.text.trim()) {
        toast.error('No text could be extracted from that file')
        return
      }
      setContent((prev) => (prev.trim() ? `${prev}\n\n${doc.text}` : doc.text))
      if (!title.trim()) setTitle(doc.filename.replace(/\.[^.]+$/, ''))
      toast.success(`Loaded ${doc.filename} · ${doc.chars.toLocaleString()} chars`)
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to read document'))
    } finally {
      setExtracting(false)
    }
  }

  function handleAdd() {
    const t = title.trim()
    const c = content.trim()
    if (!t || !c) return
    onAddItem(section.key, t, c)
    setTitle('')
    setContent('')
  }

  const activeCount = section.items.filter((i) => i.enabled).length

  return (
    <div
      className={clsx(
        'flex flex-col rounded-xl overflow-hidden border transition-colors',
        section.enabled ? 'border-gold/30' : 'border-white/[0.07]'
      )}
      style={{ background: 'var(--chat-panel-bg)' }}
    >
      {/* Section header */}
      <div
        className={clsx(
          'flex items-center justify-between px-4 py-3 border-b',
          section.enabled ? 'bg-gold/[0.07] border-gold/20' : 'bg-white/[0.025] border-white/[0.06]'
        )}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">{section.label}</p>
          <p className="text-[10px] text-text-muted mt-0.5">
            {section.items.length === 0
              ? 'No items yet'
              : `${activeCount} of ${section.items.length} item(s) active`}
          </p>
        </div>
        <Switch
          checked={section.enabled}
          onChange={() => onToggleSection(section.key, !section.enabled)}
          disabled={busy}
        />
      </div>

      {/* Items */}
      {section.items.length > 0 && (
        <div className="divide-y divide-white/[0.05]">
          {section.items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <Switch
                checked={item.enabled}
                onChange={() => onToggleItem(item.id, !item.enabled)}
                disabled={busy}
              />
              <p className="flex-1 min-w-0 text-xs text-text-secondary truncate">{item.title}</p>
              <span className="text-[10px] text-text-muted flex-shrink-0">
                {item.chars.toLocaleString()} chars
              </span>
              <button
                onClick={() => onDeleteItem(item.id)}
                disabled={busy}
                className="flex-shrink-0 text-white/20 hover:text-red-400 transition-colors disabled:opacity-40"
                title="Delete item"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add item form */}
      <div className="mt-auto p-3 border-t border-white/[0.06] space-y-2.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Standard PV format)"
          className="input-box text-xs w-full"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Paste reference text here, or drop a file below…"
          rows={3}
          className="input-box text-xs w-full resize-none"
        />
        <FileDropzone
          onFiles={handleFiles}
          accept={ACCEPT}
          multiple={false}
          compact
          label={extracting ? 'Reading document…' : 'Drop a file to extract text'}
          hint="pdf, docx, txt, md, xlsx"
        />
        <button
          onClick={handleAdd}
          disabled={!title.trim() || !content.trim() || busy}
          className="btn-primary text-xs w-full justify-center gap-1.5"
        >
          <Plus size={13} /> Add item
        </button>
      </div>
    </div>
  )
}

export function MemoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['chat-memory'],
    queryFn: memoryApi.get,
    enabled: open,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['chat-memory'] })

  const addMutation = useMutation({
    mutationFn: ({ section, title, content }: { section: MemorySectionKey; title: string; content: string }) =>
      memoryApi.addItem(section, title, content),
    onSuccess: () => {
      invalidate()
      toast.success('Item added')
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to add item')),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => memoryApi.updateItem(id, { enabled }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err, 'Failed to update item')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => memoryApi.deleteItem(id),
    onSuccess: () => {
      invalidate()
      toast.success('Item removed')
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to delete item')),
  })

  const toggleSectionMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: MemorySectionKey; enabled: boolean }) =>
      memoryApi.toggleSection(key, enabled),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err, 'Failed to update section')),
  })

  const masterMutation = useMutation({
    mutationFn: (enabled: boolean) => memoryApi.setMaster(enabled),
    onSuccess: (_, enabled) => {
      invalidate()
      toast.success(enabled ? 'All memory enabled' : 'All memory disabled')
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to update memory')),
  })

  const busy =
    addMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    toggleSectionMutation.isPending ||
    masterMutation.isPending

  const sections = data?.sections ?? []

  return (
    <Modal open={open} onClose={onClose} title="Persistent Memory" size="2xl">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs text-text-muted leading-relaxed max-w-sm">
            Reference templates and context the local Ollama model is reminded of on every
            message while active. Not used with OpenRouter.
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => masterMutation.mutate(true)}
              disabled={busy}
              className="btn-ghost text-[11px] gap-1"
            >
              All on
            </button>
            <button
              onClick={() => masterMutation.mutate(false)}
              disabled={busy}
              className="btn-ghost text-[11px] gap-1"
            >
              All off
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="flex justify-center py-10">
            <Spinner size="sm" />
          </div>
        )}

        {!isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
            {sections.map((section) => (
              <SectionCard
                key={section.key}
                section={section}
                busy={busy}
                onToggleSection={(key, enabled) => toggleSectionMutation.mutate({ key, enabled })}
                onToggleItem={(id, enabled) => updateMutation.mutate({ id, enabled })}
                onDeleteItem={(id) => deleteMutation.mutate(id)}
                onAddItem={(section, title, content) => addMutation.mutate({ section, title, content })}
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
