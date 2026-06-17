import client from './client'
import type { AuthResponse, Investor } from '../types'

export const authApi = {
  register: async (email: string, password: string, full_name?: string): Promise<AuthResponse> => {
    const { data } = await client.post('/auth/register', { email, password, full_name })
    return data
  },

  login: async (email: string, password: string): Promise<AuthResponse> => {
    const form = new URLSearchParams()
    form.append('username', email)
    form.append('password', password)
    const { data } = await client.post('/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    return data
  },

  me: async (): Promise<Investor> => {
    const { data } = await client.get('/auth/me')
    return data
  },
}
