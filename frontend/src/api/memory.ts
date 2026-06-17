import client from './client'

export type MemorySectionKey = 'pv_template' | 'board_minutes' | 'general_context'

export interface MemoryItem {
  id: number
  title: string
  content: string
  enabled: boolean
  chars: number
}

export interface MemorySection {
  key: MemorySectionKey
  label: string
  enabled: boolean
  items: MemoryItem[]
}

export interface MemoryResponse {
  sections: MemorySection[]
}

export const memoryApi = {
  get: async (): Promise<MemoryResponse> => {
    const { data } = await client.get('/chat/memory')
    return data
  },

  addItem: async (section: MemorySectionKey, title: string, content: string): Promise<MemoryItem> => {
    const { data } = await client.post('/chat/memory/items', { section, title, content })
    return data
  },

  updateItem: async (
    id: number,
    body: { title?: string; content?: string; enabled?: boolean }
  ): Promise<MemoryItem> => {
    const { data } = await client.put(`/chat/memory/items/${id}`, body)
    return data
  },

  deleteItem: async (id: number): Promise<void> => {
    await client.delete(`/chat/memory/items/${id}`)
  },

  toggleSection: async (key: MemorySectionKey, enabled: boolean): Promise<{ key: string; enabled: boolean }> => {
    const { data } = await client.put(`/chat/memory/sections/${key}`, { enabled })
    return data
  },

  setMaster: async (enabled: boolean): Promise<{ enabled: boolean }> => {
    const { data } = await client.post('/chat/memory/master', { enabled })
    return data
  },
}
