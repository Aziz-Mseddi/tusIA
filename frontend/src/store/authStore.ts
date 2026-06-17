import { create } from 'zustand'
import type { Investor } from '../types'

interface AuthState {
  token: string | null
  investor: Investor | null
  isAuthenticated: boolean
  setAuth: (token: string, investor: Investor) => void
  logout: () => void
}

const STORAGE_KEY = 'tunis-ia-auth'

function loadFromStorage(): { token: string | null; investor: Investor | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { token: null, investor: null }
    return JSON.parse(raw)
  } catch {
    return { token: null, investor: null }
  }
}

const initial = loadFromStorage()

export const useAuthStore = create<AuthState>((set) => ({
  token: initial.token,
  investor: initial.investor,
  isAuthenticated: !!initial.token,

  setAuth: (token, investor) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, investor }))
    set({ token, investor, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEY)
    set({ token: null, investor: null, isAuthenticated: false })
  },
}))
