import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send,
  User,
  Trash2,
  Plus,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Paperclip,
  FileText,
  X,
  KeyRound,
  Cpu,
  Sparkles,
  Briefcase,
  Brain,
  SlidersHorizontal,
  Square,
  Download,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Layout } from '../components/layout/Layout'
import { Spinner } from '../components/ui/Spinner'
import { Modal } from '../components/ui/Modal'
import { AIAvatar, ThinkingDots } from '../components/ui/AIAvatar'
import { ThinkingAmbience } from '../components/ui/ThinkingAmbience'
import { MemoryDrawer } from '../components/chat/MemoryDrawer'
import { chatApi, type ChatProvider, type ExtractedDocument } from '../api/chat'
import { settingsApi } from '../api/settings'
import { memoryApi } from '../api/memory'
import type { ChatMessage, ChatSession } from '../types'
import { clsx } from 'clsx'

const SUGGESTIONS = [
  'What sectors are most promising in Tunisia for 2025?',
  'How do I evaluate a Fintech startup at creation stage?',
  'What is the SICAR fiscal regime and how does it affect my investment?',
  'Explain EBITDA margin and why it matters for early-stage companies',
  'What are common failure reasons for B2C startups in North Africa?',
  'How should I interpret a high debt-to-EBITDA ratio?',
]

const ACCEPTED_FILES = '.txt,.md,.pdf,.docx,.xlsx,.xls'
const PROVIDER_KEY = 'tunis-ia-chat-provider'

// Translucent surfaces (vs the opaque global .glass-card) so the AuroraBackground
// gold beams read through the chat panels. Opacity tracks the global --surface-alpha
// (Settings → Transparency slider); chat keeps its own slightly darker base tints.
const PANEL = 'relative border border-white/[0.07]'
const PANEL_MSGS = 'relative border border-white/[0.07]'
const PANEL_BG = { background: 'var(--chat-panel-bg)' }
const PANEL_MSGS_BG = { background: 'var(--chat-msgs-bg)' }

// Pull a human-readable message out of the FastAPI error envelope.
function errorMessage(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail
  if (detail && typeof detail === 'object') return detail.detail || detail.error || fallback
  if (typeof detail === 'string') return detail
  return fallback
}

// Collapsible "thinking" trace shown above an assistant reply. Works for both
// providers — Local (Ollama) and the Online LLM — whenever the model exposes
// its reasoning.
function ReasoningPanel({ reasoning }: { reasoning: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-gold/70 hover:text-gold transition-colors"
        aria-expanded={open}
      >
        <Brain size={11} />
        {open ? 'Hide thinking' : 'Show thinking'}
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {open && (
        <div className="mt-2 pl-3 border-l-2 border-gold/25 text-[12px] leading-relaxed text-text-muted whitespace-pre-wrap italic">
          {reasoning}
        </div>
      )}
    </div>
  )
}

// "Download PDF" action under an assistant reply. Renders the reply text into a
// PDF server-side (markdown structure preserved) and triggers a browser download.
function DownloadPdfButton({ content }: { content: string }) {
  const [busy, setBusy] = useState(false)
  async function download() {
    if (busy) return
    setBusy(true)
    try {
      const blob = await chatApi.exportPdf(content)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2')
      a.href = url
      a.download = `pv-${stamp}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to generate PDF')
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      className="mt-2.5 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-gold/70 hover:text-gold transition-colors disabled:opacity-50"
    >
      <Download size={11} />
      {busy ? 'Generating…' : 'Download PDF'}
    </button>
  )
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={clsx('flex gap-3 animate-msg-in', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {isUser ? (
        <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-primary/20">
          <User size={15} className="text-primary" />
        </div>
      ) : (
        <AIAvatar size={32} calm />
      )}
      <div
        className={clsx(
          'max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-primary/15 text-text-primary rounded-tr-sm border border-primary/20'
            : 'bg-white/[0.04] text-text-secondary rounded-tl-sm border border-white/[0.07]'
        )}
      >
        {!isUser && msg.reasoning && <ReasoningPanel reasoning={msg.reasoning} />}
        <p className="whitespace-pre-wrap">{msg.content}</p>
        {!isUser && msg.content?.trim() && <DownloadPdfButton content={msg.content} />}
      </div>
    </div>
  )
}

function SessionItem({
  session,
  active,
  onSelect,
  onDelete,
}: {
  session: ChatSession
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      className={clsx(
        'group flex items-start gap-2.5 px-3 py-2.5 cursor-pointer transition-colors border-l-2',
        active
          ? 'border-l-gold bg-white/[0.04] text-text-primary'
          : 'border-l-transparent text-text-muted hover:bg-white/[0.025] hover:text-text-secondary'
      )}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <MessageSquare size={13} className="flex-shrink-0 mt-0.5 text-white/30" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] truncate leading-tight font-medium">{session.title}</p>
        <p className="text-[10px] text-white/20 mt-0.5">
          {session.message_count} msg
          {session.updated_at
            ? ` · ${formatDistanceToNow(new Date(session.updated_at), { addSuffix: true })}`
            : ''}
        </p>
      </div>
      {hover && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="flex-shrink-0 text-white/20 hover:text-red-400 transition-colors"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}

function ProviderToggle({
  provider,
  onChange,
}: {
  provider: ChatProvider
  onChange: (p: ChatProvider) => void
}) {
  const base =
    'flex items-center gap-1.5 px-2.5 py-[7px] text-[11px] font-mono transition-colors'
  const active = 'bg-gold/15 text-gold'
  const idle = 'text-text-muted hover:text-text-secondary hover:bg-white/[0.04]'
  return (
    <div className="flex items-center border border-white/[0.08] overflow-hidden">
      <button
        type="button"
        onClick={() => onChange('local')}
        className={clsx(base, provider === 'local' ? active : idle)}
        title="Run locally via Ollama"
      >
        <Cpu size={12} /> Local
      </button>
      <button
        type="button"
        onClick={() => onChange('openrouter')}
        className={clsx(base, provider === 'openrouter' ? active : idle)}
        title="Use the online LLM (your API key)"
      >
        <Sparkles size={12} /> Online LLM
      </button>
    </div>
  )
}

export default function ChatPage() {
  const queryClient = useQueryClient()
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [provider, setProvider] = useState<ChatProvider>(
    () => (localStorage.getItem(PROVIDER_KEY) as ChatProvider) || 'local'
  )
  const [webSearch, setWebSearch] = useState(false)
  const [includePortfolio, setIncludePortfolio] = useState(false)
  const [includeMemory, setIncludeMemory] = useState(false)
  const [memoryModalOpen, setMemoryModalOpen] = useState(false)
  const [attachment, setAttachment] = useState<ExtractedDocument | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [keyModalOpen, setKeyModalOpen] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Lets the user stop a request mid-flight (Stop button while loading).
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    localStorage.setItem(PROVIDER_KEY, provider)
  }, [provider])

  // Fetch sessions list
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['chat-sessions'],
    queryFn: chatApi.listSessions,
    retry: false,
  })

  // Per-user cloud key status (masked — never the raw key)
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    retry: false,
  })

  // Persistent memory drop-in — used for the active-item count badge
  const { data: memoryData } = useQuery({
    queryKey: ['chat-memory'],
    queryFn: memoryApi.get,
    retry: false,
  })
  const activeMemoryCount = (memoryData?.sections ?? []).reduce(
    (sum, s) => (s.enabled ? sum + s.items.filter((i) => i.enabled).length : sum),
    0
  )

  const sessions = sessionsData?.sessions ?? []

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Load a session's messages
  const loadSession = useCallback(async (id: number) => {
    setActiveSessionId(id)
    setLoading(true)
    try {
      const detail = await chatApi.getSession(id)
      setMessages(detail.messages)
    } catch {
      toast.error('Failed to load session')
    } finally {
      setLoading(false)
    }
  }, [])

  // Create new session
  const createMutation = useMutation({
    mutationFn: chatApi.createSession,
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
      setActiveSessionId(session.id)
      setMessages([])
    },
    onError: () => toast.error('Failed to create session'),
  })

  // Delete session
  const deleteMutation = useMutation({
    mutationFn: chatApi.deleteSession,
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
      if (activeSessionId === deletedId) {
        setActiveSessionId(null)
        setMessages([])
      }
    },
    onError: () => toast.error('Failed to delete session'),
  })

  // Save / clear the OpenRouter API key
  const saveKeyMutation = useMutation({
    mutationFn: (k: string) => settingsApi.saveApiKey(k),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('OpenRouter API key saved')
      setKeyInput('')
      setKeyModalOpen(false)
    },
    onError: () => toast.error('Failed to save key'),
  })

  const clearKeyMutation = useMutation({
    mutationFn: settingsApi.clearApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('OpenRouter API key removed')
      if (provider === 'openrouter') setProvider('local')
    },
    onError: () => toast.error('Failed to remove key'),
  })

  function handleProviderChange(p: ChatProvider) {
    setProvider(p)
    if (p !== 'openrouter') setWebSearch(false)
    if (p === 'openrouter' && !settings?.openrouter_key_set) {
      setKeyModalOpen(true)
      toast('Add your OpenRouter API key to use the cloud model.', { icon: <KeyRound size={16} /> })
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setAttaching(true)
    try {
      const doc = await chatApi.extractDocument(file)
      if (!doc.text.trim()) {
        toast.error('No text could be extracted from that file')
        return
      }
      setAttachment(doc)
      toast.success(`Attached ${doc.filename} · ${doc.chars.toLocaleString()} chars`)
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to read document'))
    } finally {
      setAttaching(false)
    }
  }

  async function send(text?: string) {
    const typed = (text ?? input).trim()
    if (!typed && !attachment) return

    if (provider === 'openrouter' && !settings?.openrouter_key_set) {
      setKeyModalOpen(true)
      toast.error('Add your OpenRouter API key first')
      return
    }

    // Fold the attached document into the message so both the model and the
    // saved history retain it for follow-up questions.
    const content = attachment
      ? `[Attached document: ${attachment.filename}]\n"""\n${attachment.text}\n"""\n\n${typed || 'Please analyze the attached document.'}`
      : typed

    const sentAttachment = attachment
    setInput('')
    setAttachment(null)

    // If no active session, create one first
    let sessionId = activeSessionId
    if (!sessionId) {
      try {
        const newSession = await chatApi.createSession()
        queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
        setActiveSessionId(newSession.id)
        sessionId = newSession.id
      } catch {
        toast.error('Failed to start session')
        setInput(typed)
        setAttachment(sentAttachment)
        return
      }
    }

    const userMsg: ChatMessage = { role: 'user', content }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await chatApi.sendMessage(sessionId, content, provider, webSearch, includePortfolio, includeMemory && provider === 'local', controller.signal)
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply, reasoning: res.reasoning }])
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
    } catch (err: any) {
      // User pressed Stop — keep their message, drop the pending reply, no error.
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') {
        return
      }
      const fallback =
        provider === 'openrouter'
          ? 'OpenRouter request failed'
          : 'AI is offline — is Ollama running?'
      toast.error(errorMessage(err, fallback))
      if (provider === 'openrouter' && err?.response?.status === 400) setKeyModalOpen(true)
      // Roll back the optimistic message and let the user retry
      setMessages((prev) => prev.slice(0, -1))
      setInput(typed)
      setAttachment(sentAttachment)
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  // Abort an in-flight request. The reply is discarded client-side; the user's
  // message stays in the thread so they can edit or resend.
  function stopGenerating() {
    abortRef.current?.abort()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function handleNewChat() {
    setActiveSessionId(null)
    setMessages([])
    setAttachment(null)
  }

  return (
    <Layout title="AI Assistant">
      <div className="relative z-10 flex gap-0 h-[calc(100vh-120px)]">
        {/* ── History Sidebar ────────────────────────── */}
        <div
          className={clsx(
            'flex-shrink-0 transition-all duration-300 overflow-hidden',
            sidebarOpen ? 'w-56' : 'w-0'
          )}
        >
          <div className={clsx('w-56 h-full flex flex-col mr-4', PANEL)} style={PANEL_BG}>
            {/* New Chat */}
            <div className="p-3 border-b border-white/[0.06]">
              <button
                onClick={handleNewChat}
                className="btn-primary w-full justify-center gap-2 text-xs"
              >
                <Plus size={13} /> New Chat
              </button>
            </div>

            {/* Sessions list */}
            <div className="flex-1 overflow-y-auto py-1">
              {sessionsLoading && (
                <div className="flex justify-center py-6">
                  <Spinner size="sm" />
                </div>
              )}
              {!sessionsLoading && sessions.length === 0 && (
                <p className="text-[10px] text-white/20 text-center py-6 tracking-wide px-3">
                  No conversations yet
                </p>
              )}
              {sessions.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  active={s.id === activeSessionId}
                  onSelect={() => loadSession(s.id)}
                  onDelete={() => deleteMutation.mutate(s.id)}
                />
              ))}
            </div>

            {/* Footer count */}
            <div className="p-3 border-t border-white/[0.06]">
              <p className="text-[10px] text-white/20 tracking-widest uppercase text-center">
                {sessions.length} conversation{sessions.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </div>

        {/* ── Main Chat Area ─────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Header */}
          <div className={clsx('p-4 mb-4 flex items-center justify-between gap-3', PANEL)} style={PANEL_BG}>
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="btn-ghost p-1.5 mr-1"
                title={sidebarOpen ? 'Hide history' : 'Show history'}
              >
                {sidebarOpen ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
              </button>
              <AIAvatar size={38} thinking={loading} />
              <div className="min-w-0">
                <h3 className="font-semibold text-text-primary">TunisIA</h3>
                <p className="text-xs text-text-muted truncate">
                  {activeSessionId
                    ? sessions.find((s) => s.id === activeSessionId)?.title ?? 'AI Assistant'
                    : 'AI Investment Assistant · North African Markets'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <ProviderToggle provider={provider} onChange={handleProviderChange} />
              <button
                type="button"
                onClick={() => setIncludePortfolio((v) => !v)}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-[7px] text-[11px] font-mono border transition-colors',
                  includePortfolio
                    ? 'bg-gold/15 text-gold border-gold/30'
                    : 'text-text-muted border-white/[0.08] hover:text-text-secondary hover:bg-white/[0.04]'
                )}
                title={
                  includePortfolio
                    ? 'Portfolio context enabled — your investments & to-do list are shared with the assistant'
                    : 'Give the assistant access to your investments and to-do list'
                }
              >
                <Briefcase size={12} />
                Portfolio
              </button>
              <button
                type="button"
                onClick={() => provider === 'local' && setIncludeMemory((v) => !v)}
                disabled={provider !== 'local'}
                className={clsx(
                  'flex items-center gap-1.5 px-2.5 py-[7px] text-[11px] font-mono border transition-colors',
                  provider !== 'local'
                    ? 'opacity-40 cursor-not-allowed text-text-muted border-white/[0.08]'
                    : includeMemory
                    ? 'bg-gold/15 text-gold border-gold/30'
                    : 'text-text-muted border-white/[0.08] hover:text-text-secondary hover:bg-white/[0.04]'
                )}
                title={
                  provider !== 'local'
                    ? 'Persistent memory is only available with the local Ollama model'
                    : includeMemory
                    ? 'Persistent memory enabled — saved templates & context are shared with the assistant'
                    : 'Give the assistant access to your saved templates and context'
                }
              >
                <Brain size={12} />
                Memory
                {activeMemoryCount > 0 && (
                  <span
                    className={clsx(
                      'flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-semibold',
                      includeMemory && provider === 'local' ? 'bg-gold/25 text-gold' : 'bg-white/10 text-text-muted'
                    )}
                  >
                    {activeMemoryCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setMemoryModalOpen(true)}
                className="btn-ghost p-1.5"
                title="Manage persistent memory"
              >
                <SlidersHorizontal size={14} />
              </button>
              <button
                onClick={() => setKeyModalOpen(true)}
                className={clsx(
                  'btn-ghost p-1.5',
                  settings?.openrouter_key_set ? 'text-gold/80' : ''
                )}
                title="Manage OpenRouter API key"
              >
                <KeyRound size={14} />
              </button>
              {messages.length > 0 && (
                <button onClick={handleNewChat} className="btn-ghost text-xs gap-1.5">
                  <Plus size={12} /> New
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className={clsx('flex-1 overflow-y-auto p-5 space-y-4 mb-4', PANEL_MSGS)} style={PANEL_MSGS_BG}>
            <ThinkingAmbience active={loading} />
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <AIAvatar size={64} className="mb-5" />
                <h3 className="font-display font-light tracking-[-0.01em] text-[30px] text-text-primary mb-2">
                  How can I help you?
                </h3>
                <p className="text-sm text-text-muted mb-6 max-w-sm leading-relaxed">
                  I'm TunisIA, your AI investment assistant specializing in Tunisian markets and
                  comparable emerging economies.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-left px-3 py-2.5 text-xs text-text-secondary bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.07] hover:border-white/[0.15] rounded-xl transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}

            {loading && (
              <div className="flex gap-3 animate-msg-in">
                <AIAvatar size={32} thinking />
                <div className="flex items-center px-4 py-3 bg-white/[0.04] rounded-2xl rounded-tl-sm border border-white/[0.07]">
                  <ThinkingDots label={
                    provider === 'openrouter' ? 'Online LLM' : 'Local'
                  } />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className={clsx('p-3', PANEL)} style={PANEL_BG}>
            {attachment && (
              <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-lg bg-gold/10 border border-gold/20 text-xs animate-msg-in">
                <FileText size={13} className="text-gold flex-shrink-0" />
                <span className="text-text-secondary truncate flex-1">{attachment.filename}</span>
                <span className="text-text-muted flex-shrink-0">
                  {attachment.chars.toLocaleString()} chars
                </span>
                <button
                  onClick={() => setAttachment(null)}
                  className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
                  title="Remove attachment"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <div className="flex gap-3 items-end">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFile}
                accept={ACCEPTED_FILES}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={attaching || loading}
                className="btn-ghost flex-shrink-0 h-11 px-3"
                title="Attach a document (txt, pdf, docx, xlsx)"
              >
                {attaching ? <Spinner size="sm" /> : <Paperclip size={16} />}
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about investments, startups, or market analysis... (Enter to send)"
                className="input-base flex-1 resize-none min-h-[44px] max-h-32"
                rows={1}
                style={{ height: Math.min(Math.max(44, input.split('\n').length * 24), 128) }}
              />
              {loading ? (
                <button
                  onClick={stopGenerating}
                  className="btn-primary flex-shrink-0 h-11 gap-2"
                  title="Stop generating"
                >
                  <Square size={13} className="fill-current" /> Stop
                </button>
              ) : (
                <button
                  onClick={() => send()}
                  disabled={!input.trim() && !attachment}
                  className="btn-primary flex-shrink-0 h-11"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
            <p className="text-[10px] text-text-muted mt-2 text-center">
              Shift+Enter for new line · Enter to send ·{' '}
              {provider === 'openrouter'
                ? 'Using Online LLM'
                : 'Using local Ollama'}
              {includeMemory && provider === 'local' ? ' · Memory on' : ''}{' '}
              · Attach txt/pdf/docx/xlsx
            </p>
          </div>
        </div>
      </div>

      {/* ── OpenRouter API key modal ───────────────────────── */}
      <Modal open={keyModalOpen} onClose={() => setKeyModalOpen(false)} title="OpenRouter API Key">
        <div className="space-y-4">
          <p className="text-xs text-text-muted leading-relaxed">
            Paste your OpenRouter API key to run prompts on the cloud model. Get one at{' '}
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="text-gold hover:underline"
            >
              openrouter.ai/keys
            </a>
            .
            {settings?.openrouter_key_set && (
              <>
                {' '}
                Current key:{' '}
                <span className="text-text-secondary">{settings.openrouter_key_masked}</span>
              </>
            )}
          </p>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-or-..."
            className="input-box w-full"
            autoComplete="off"
          />
          <div className="flex items-center justify-end gap-2">
            {settings?.openrouter_key_set && (
              <button
                onClick={() => clearKeyMutation.mutate()}
                disabled={clearKeyMutation.isPending}
                className="btn-ghost text-xs text-red-400 hover:text-red-300"
              >
                Remove key
              </button>
            )}
            <button
              onClick={() => saveKeyMutation.mutate(keyInput.trim())}
              disabled={!keyInput.trim() || saveKeyMutation.isPending}
              className="btn-primary text-xs"
            >
              {saveKeyMutation.isPending ? <Spinner size="sm" /> : 'Save key'}
            </button>
          </div>
          <p className="text-[10px] text-text-muted/70 leading-relaxed">
            Stored on the server for your account. For production deployments, keys should be
            encrypted at rest rather than kept in plaintext.
          </p>
        </div>
      </Modal>

      {/* ── Persistent memory drawer ─────────────────────── */}
      <MemoryDrawer open={memoryModalOpen} onClose={() => setMemoryModalOpen(false)} />
    </Layout>
  )
}
