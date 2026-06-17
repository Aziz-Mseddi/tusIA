import client from './client'
import type {
  FindAnaloguesResponse,
  FindAnaloguesBatchResponse,
  StartupProfile,
  AnaloguesSummary,
  FounderQuestionsResponse,
  Mode2AssessmentSummary,
  Mode2AssessmentDetail,
  Mode2Job,
} from '../types'

export const mode2Api = {
  extractProfile: async (files: File[]): Promise<{ job_id: number }> => {
    const form = new FormData()
    files.forEach((f) => form.append('files', f))
    const { data } = await client.post('/mode2/extract-profile', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  getJob: async (jobId: number): Promise<Mode2Job> => {
    const { data } = await client.get(`/mode2/jobs/${jobId}`)
    return data
  },

  findAnalogues: async (profile: StartupProfile): Promise<FindAnaloguesResponse> => {
    const { data } = await client.post('/mode2/find-analogues', { profile })
    return data
  },

  findAnaloguesBatch: async (profiles: StartupProfile[]): Promise<FindAnaloguesBatchResponse> => {
    const { data } = await client.post('/mode2/find-analogues-batch', { profiles })
    return data
  },

  viabilityVerdict: async (
    profile: StartupProfile,
    analogues_summary: AnaloguesSummary
  ): Promise<{ job_id: number }> => {
    const { data } = await client.post('/mode2/viability-verdict', {
      profile,
      analogues_summary,
    })
    return data
  },

  viabilityVerdictBatch: async (
    items: { name: string; profile: StartupProfile; analogues_summary: AnaloguesSummary }[]
  ): Promise<{ job_id: number }> => {
    const { data } = await client.post('/mode2/viability-verdict-batch', { items })
    return data
  },

  explainAnalogue: async (
    startup_id: number,
    question: string,
    tunisian_profile_summary: string
  ): Promise<{ answer: string; startup_id: number }> => {
    const { data } = await client.post('/mode2/explain-analogue', {
      startup_id,
      question,
      tunisian_profile_summary,
    })
    return data
  },

  founderQuestions: async (
    profile: StartupProfile,
    analogues_summary: AnaloguesSummary
  ): Promise<FounderQuestionsResponse> => {
    const { data } = await client.post('/mode2/founder-questions', {
      profile,
      analogues_summary,
    })
    return data
  },

  saveAssessment: async (payload: {
    title?: string
    is_multiple: boolean
    profile: unknown
    analogues?: unknown
    verdict?: unknown
    source_filenames?: string[]
  }): Promise<Mode2AssessmentSummary> => {
    const { data } = await client.post('/mode2/assessments', payload)
    return data
  },

  listAssessments: async (): Promise<Mode2AssessmentSummary[]> => {
    const { data } = await client.get('/mode2/assessments')
    return data
  },

  getAssessment: async (id: number): Promise<Mode2AssessmentDetail> => {
    const { data } = await client.get(`/mode2/assessments/${id}`)
    return data
  },

  deleteAssessment: async (id: number): Promise<{ deleted: boolean }> => {
    const { data } = await client.delete(`/mode2/assessments/${id}`)
    return data
  },
}
