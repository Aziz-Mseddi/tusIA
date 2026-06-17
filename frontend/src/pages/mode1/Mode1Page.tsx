import { useState, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Search, Sparkles, Lightbulb, SlidersHorizontal, X, ChevronDown, ChevronUp, MessageCircleQuestion, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { Layout } from '../../components/layout/Layout'
import { FilterPanel } from '../../components/startup/FilterPanel'
import { StartupCard } from '../../components/startup/StartupCard'
import { FullPageSpinner, Spinner } from '../../components/ui/Spinner'
import { ThinkingDots } from '../../components/ui/AIAvatar'
import { startupsApi } from '../../api/startups'
import { mode1Api } from '../../api/mode1'
import type { FilterRequest, Startup, InvestmentSuggestion } from '../../types'
import { clsx } from 'clsx'

const EMPTY_FILTERS: FilterRequest = {}

type SearchMode = 'filter' | 'ai'

export default function Mode1Page() {
  const [mode, setMode] = useState<SearchMode>('filter')
  const [filters, setFilters] = useState<FilterRequest>(EMPTY_FILTERS)
  const [prompt, setPrompt] = useState('')
  const [results, setResults] = useState<Startup[] | null>(null)
  const [total, setTotal] = useState(0)
  const [interpretedFilters, setInterpretedFilters] = useState<Record<string, unknown> | null>(null)
  const [showFilters, setShowFilters] = useState(true)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [explainedBullets, setExplainedBullets] = useState<Record<number, string[]>>({})
  const [askQuestion, setAskQuestion] = useState('')
  const [askAnswer, setAskAnswer] = useState('')

  const { data: meta, isLoading: metaLoading } = useQuery({
    queryKey: ['startups-meta'],
    queryFn: startupsApi.meta,
  })

  const { data: suggestions, isLoading: suggestionsLoading, refetch: fetchSuggestions } = useQuery({
    queryKey: ['suggestions'],
    queryFn: mode1Api.suggestions,
    enabled: false,
    staleTime: 300_000,
  })

  const filterMutation = useMutation({
    mutationFn: mode1Api.filter,
    onSuccess: (data) => {
      setResults(data.results)
      setTotal(data.total)
      setInterpretedFilters(null)
    },
    onError: () => toast.error('Filter failed'),
  })

  const promptMutation = useMutation({
    mutationFn: (p: string) => mode1Api.promptFilter(p),
    onSuccess: (data) => {
      setResults(data.results)
      setTotal(data.total)
      setInterpretedFilters(data.interpreted_filters)
    },
    onError: () => toast.error('AI filter failed — is Ollama running?'),
  })

  const explainSuggestionMutation = useMutation({
    mutationFn: ({ suggestion }: { index: number; suggestion: InvestmentSuggestion }) =>
      mode1Api.explainSuggestion(suggestion),
    onSuccess: (data, { index }) => {
      setExplainedBullets((prev) => ({ ...prev, [index]: data.bullets }))
    },
    onError: () => toast.error('Could not simplify this suggestion — is Ollama running?'),
  })

  const askMutation = useMutation({
    mutationFn: (q: string) => mode1Api.askAboutSuggestions(q, suggestions?.suggestions ?? []),
    onSuccess: (data) => setAskAnswer(data.answer),
    onError: () => toast.error('AI assistant failed — is Ollama running?'),
  })

  const handleAsk = useCallback(() => {
    if (!askQuestion.trim()) return
    askMutation.mutate(askQuestion)
  }, [askQuestion, askMutation])

  const handleFilter = useCallback(() => {
    filterMutation.mutate(filters)
  }, [filters, filterMutation])

  const handlePromptSearch = useCallback(() => {
    if (!prompt.trim()) return
    promptMutation.mutate(prompt)
  }, [prompt, promptMutation])

  const handleSuggestions = () => {
    setShowSuggestions(true)
    fetchSuggestions()
  }

  const isLoading = filterMutation.isPending || promptMutation.isPending

  return (
    <Layout title="Startup Explorer">
      <div className="mb-6">
        <h2 className="page-title">Startup Explorer</h2>
        <p className="text-sm text-text-muted mt-1">Browse and filter {meta?.total ?? '...'} startups across MENA, Africa & Asia</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar Filters */}
        <div className={clsx(
          'flex-shrink-0 transition-all duration-300',
          showFilters ? 'w-64' : 'w-0 overflow-hidden'
        )}>
          {meta && showFilters && (
            <div className="glass-card p-4 sticky top-20">
              <FilterPanel
                meta={meta}
                filters={filters}
                onChange={setFilters}
                onReset={() => setFilters(EMPTY_FILTERS)}
              />
              <button
                onClick={handleFilter}
                disabled={isLoading}
                className="btn-primary w-full justify-center mt-4"
              >
                {filterMutation.isPending ? <Spinner size="sm" /> : <><Search size={15} />Apply Filters</>}
              </button>
            </div>
          )}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Search Bar */}
          <div className="glass-card p-4 mb-5">
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => { setMode('filter'); setInterpretedFilters(null) }}
                className={clsx('tab-inactive px-3 py-1.5 text-sm transition-colors', mode === 'filter' && 'tab-active')}
              >
                <Search size={14} className="inline mr-1.5" />Filter
              </button>
              <button
                onClick={() => setMode('ai')}
                className={clsx('tab-inactive px-3 py-1.5 text-sm transition-colors', mode === 'ai' && 'tab-active')}
              >
                <Sparkles size={14} className="inline mr-1.5" />AI Search
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="btn-ghost text-xs gap-1.5"
              >
                <SlidersHorizontal size={13} />
                {showFilters ? 'Hide' : 'Show'} Filters
              </button>
              <button onClick={handleSuggestions} className="btn-ghost text-xs gap-1.5">
                <Lightbulb size={13} />
                AI Themes
              </button>
            </div>

            {mode === 'ai' ? (
              <div className="flex gap-2">
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handlePromptSearch()}
                  placeholder="e.g., Find fintech startups in Morocco with low risk and high growth..."
                  className="input-base flex-1"
                />
                <button onClick={handlePromptSearch} disabled={isLoading} className="btn-primary px-5 flex-shrink-0">
                  {promptMutation.isPending ? <Spinner size="sm" /> : <Sparkles size={15} />}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 text-sm text-text-muted">
                  Use the filter panel to refine results, then click Apply.
                </div>
                <button onClick={handleFilter} disabled={isLoading} className="btn-primary">
                  {filterMutation.isPending ? <Spinner size="sm" /> : <><Search size={15} /> Search</>}
                </button>
              </div>
            )}

            {interpretedFilters && (
              <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                <p className="text-xs font-medium text-primary mb-1">AI Extracted Filters:</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(interpretedFilters).map(([k, v]) =>
                    v != null && (Array.isArray(v) ? v.length > 0 : true) ? (
                      <span key={k} className="text-xs px-2 py-0.5 bg-white/5 rounded text-text-secondary border border-white/10">
                        {k}: {Array.isArray(v) ? v.join(', ') : String(v)}
                      </span>
                    ) : null
                  )}
                </div>
              </div>
            )}
          </div>

          {/* AI Suggestions panel */}
          {showSuggestions && (
            <div className="glass-card p-5 mb-5 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Lightbulb size={16} className="text-accent" />
                  <h3 className="font-semibold text-text-primary">AI Investment Themes</h3>
                </div>
                <button onClick={() => setShowSuggestions(false)} className="btn-ghost p-1">
                  <X size={14} />
                </button>
              </div>
              {suggestionsLoading ? (
                <div className="flex justify-center py-4"><Spinner /></div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {suggestions?.suggestions.map((s, i) => (
                    <div key={i} className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.07]">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-sm font-semibold text-text-primary leading-tight">{s.theme}</h4>
                        <span className={clsx(
                          'ml-2 text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0',
                          s.risk_level === 'Low' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' :
                          s.risk_level === 'Medium' ? 'bg-amber-500/15 text-amber-400 border-amber-500/25' :
                          'bg-red-500/15 text-red-400 border-red-500/25'
                        )}>{s.risk_level}</span>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed mb-2">{s.rationale}</p>
                      <div className="flex flex-wrap gap-1">
                        {s.supporting_sectors.map((sec) => (
                          <span key={sec} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-muted">{sec}</span>
                        ))}
                      </div>
                      {s.example_countries.length > 0 && (
                        <p className="text-[10px] text-text-muted mt-2">
                          Examples: {s.example_countries.join(', ')}
                        </p>
                      )}

                      {/* Explain simply */}
                      <div className="mt-3 pt-3 border-t border-white/[0.06]">
                        {explainedBullets[i] ? (
                          <ul className="space-y-1">
                            {explainedBullets[i].map((b, bi) => (
                              <li key={bi} className="text-[11px] text-text-secondary leading-relaxed flex gap-1.5">
                                <span className="text-accent">•</span>
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <button
                            onClick={() => explainSuggestionMutation.mutate({ index: i, suggestion: s })}
                            disabled={explainSuggestionMutation.isPending}
                            className="btn-ghost text-[11px] gap-1 px-0"
                          >
                            {explainSuggestionMutation.isPending && explainSuggestionMutation.variables?.index === i
                              ? <Spinner size="sm" />
                              : <Lightbulb size={11} />}
                            Explain in simple terms
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Ask AI assistant */}
              {!suggestionsLoading && suggestions && suggestions.suggestions.length > 0 && (
                <div className="mt-5 pt-4 border-t border-white/[0.07]">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageCircleQuestion size={14} className="text-accent" />
                    <h4 className="text-xs font-semibold text-text-primary">Ask the AI assistant about these ideas</h4>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={askQuestion}
                      onChange={(e) => setAskQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                      placeholder="e.g., Why is fintech a good idea right now?"
                      className="input-base flex-1 text-sm"
                    />
                    <button onClick={handleAsk} disabled={askMutation.isPending} className="btn-primary px-4 flex-shrink-0">
                      {askMutation.isPending ? <Spinner size="sm" /> : <Send size={14} />}
                    </button>
                  </div>
                  {askMutation.isPending && (
                    <div className="mt-2"><ThinkingDots label="Thinking..." /></div>
                  )}
                  {askAnswer && !askMutation.isPending && (
                    <p className="text-xs text-text-secondary leading-relaxed mt-3 p-3 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                      {askAnswer}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {isLoading && <div className="flex justify-center py-20"><Spinner size="lg" /></div>}

          {!isLoading && results !== null && (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-text-secondary">
                  <span className="font-semibold text-text-primary">{total}</span> results
                </p>
              </div>

              {results.length === 0 ? (
                <div className="glass-card p-12 text-center">
                  <Search size={32} className="text-text-muted mx-auto mb-3" />
                  <p className="text-text-secondary font-medium">No startups match your criteria</p>
                  <p className="text-xs text-text-muted mt-1">Try adjusting your filters</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {results.map((s) => (
                    <StartupCard key={s.id} startup={s} />
                  ))}
                </div>
              )}
            </>
          )}

          {!isLoading && results === null && !metaLoading && (
            <div className="glass-card p-12 text-center">
              <Search size={40} className="text-text-muted mx-auto mb-4" />
              <p className="text-lg font-medium text-text-secondary">Ready to explore</p>
              <p className="text-sm text-text-muted mt-1">Apply filters or use AI search to discover startups</p>
              <button onClick={handleFilter} className="btn-primary mt-5">
                <Search size={15} /> Browse All Startups
              </button>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
