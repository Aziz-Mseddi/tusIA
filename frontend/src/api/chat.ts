import client from './client'
import type {
  ChatMessage,
  ChatResponse,
  ChatSession,
  ChatSessionsResponse,
  ChatSessionDetail,
} from '../types'

export type ChatProvider = 'local' | 'openrouter'

export interface ExtractedDocument {
  filename: string
  text: string
  chars: number
}

export const chatApi = {
  // Stateless (no history persistence)
  send: async (
    messages: ChatMessage[],
    provider: ChatProvider = 'local'
  ): Promise<ChatResponse> => {
    const { data } = await client.post('/chat', { messages, provider })
    return data
  },

  // Convert an uploaded document (txt/pdf/docx/xlsx) to plain text
  extractDocument: async (file: File): Promise<ExtractedDocument> => {
    const form = new FormData()
    form.append('file', file)
    const { data } = await client.post('/chat/extract-document', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data
  },

  // Render a reply (markdown) into a downloadable PDF
  exportPdf: async (content: string, title?: string): Promise<Blob> => {
    const { data } = await client.post(
      '/chat/export-pdf',
      { content, title },
      { responseType: 'blob' }
    )
    return data
  },

  // Session management
  createSession: async (): Promise<ChatSession> => {
    const { data } = await client.post('/chat/sessions')
    return data
  },

  listSessions: async (): Promise<ChatSessionsResponse> => {
    const { data } = await client.get('/chat/sessions')
    return data
  },

  getSession: async (id: number): Promise<ChatSessionDetail> => {
    const { data } = await client.get(`/chat/sessions/${id}`)
    return data
  },

  sendMessage: async (
    sessionId: number,
    content: string,
    provider: ChatProvider = 'local',
    webSearch: boolean = false,
    includePortfolio: boolean = false,
    includeMemory: boolean = false,
    signal?: AbortSignal
  ): Promise<{ reply: string; reasoning?: string; session_id: number }> => {
    const { data } = await client.post(
      `/chat/sessions/${sessionId}/messages`,
      {
        role: 'user',
        content,
        provider,
        web_search: webSearch,
        include_portfolio: includePortfolio,
        include_memory: includeMemory,
      },
      { signal }
    )
    return data
  },

  deleteSession: async (id: number): Promise<void> => {
    await client.delete(`/chat/sessions/${id}`)
  },
}
