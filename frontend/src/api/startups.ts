import client from './client'
import type { StartupMeta, Startup } from '../types'

export const startupsApi = {
  meta: async (): Promise<StartupMeta> => {
    const { data } = await client.get('/startups/meta')
    return data
  },

  get: async (id: number): Promise<Startup> => {
    const { data } = await client.get(`/startups/${id}`)
    return data
  },

  health: async () => {
    const { data } = await client.get('/health')
    return data
  },
}
