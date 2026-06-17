import client from './client'
import type {
  FilterRequest, FilterResponse, PromptFilterResponse, SuggestionsResponse,
  ThemesLatestResponse, ThemeRunResponse, InvestmentSuggestion,
} from '../types'

export const mode1Api = {
  filter: async (filters: FilterRequest): Promise<FilterResponse> => {
    const { data } = await client.post('/mode1/filter', filters)
    return data
  },

  promptFilter: async (prompt: string): Promise<PromptFilterResponse> => {
    const { data } = await client.post('/mode1/prompt-filter', { prompt })
    return data
  },

  suggestions: async (): Promise<SuggestionsResponse> => {
    const { data } = await client.get('/mode1/suggestions')
    return data
  },

  explainSuggestion: async (suggestion: InvestmentSuggestion): Promise<{ bullets: string[] }> => {
    const { data } = await client.post('/mode1/suggestions/explain', {
      theme: suggestion.theme,
      rationale: suggestion.rationale,
      supporting_sectors: suggestion.supporting_sectors,
      risk_level: suggestion.risk_level,
    })
    return data
  },

  askAboutSuggestions: async (question: string, suggestions: InvestmentSuggestion[]): Promise<{ answer: string }> => {
    const { data } = await client.post('/mode1/suggestions/ask', { question, suggestions })
    return data
  },

  explain: async (startup_id: number, question: string): Promise<{ answer: string; startup_id: number }> => {
    const { data } = await client.post('/mode1/explain', { startup_id, question })
    return data
  },

  themesLatest: async (): Promise<ThemesLatestResponse> => {
    const { data } = await client.get('/mode1/themes/latest')
    return data
  },

  runThemesNow: async (): Promise<ThemeRunResponse> => {
    const { data } = await client.post('/mode1/themes/run-now')
    return data
  },
}
