import client from './client'

export interface SettingsResponse {
  openrouter_key_set: boolean
  openrouter_key_masked: string | null
}

export const settingsApi = {
  get: async (): Promise<SettingsResponse> => {
    const { data } = await client.get('/settings')
    return data
  },

  saveApiKey: async (openrouter_api_key: string): Promise<SettingsResponse> => {
    const { data } = await client.put('/settings/api-key', { openrouter_api_key })
    return data
  },

  clearApiKey: async (): Promise<SettingsResponse> => {
    const { data } = await client.delete('/settings/api-key')
    return data
  },
}
