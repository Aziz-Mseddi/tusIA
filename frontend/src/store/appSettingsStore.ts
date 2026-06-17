import { create } from 'zustand'

export type Theme = 'dark' | 'light'

interface AppSettingsState {
  theme: Theme
  setTheme: (t: Theme) => void
  /** Panel surface opacity, as a percent (40–100). Drives --surface-alpha. */
  transparency: number
  setTransparency: (n: number) => void
}

const STORAGE_KEY = 'tunis-ia-app-settings'

const TRANSPARENCY_MIN = 40
const TRANSPARENCY_MAX = 100
const TRANSPARENCY_DEFAULT = 72

function clampTransparency(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return TRANSPARENCY_DEFAULT
  return Math.min(TRANSPARENCY_MAX, Math.max(TRANSPARENCY_MIN, Math.round(v)))
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

function applyTransparency(percent: number) {
  document.documentElement.style.setProperty('--surface-alpha', String(percent / 100))
}

function loadFromStorage(): { theme: Theme; transparency: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { theme: 'dark', transparency: TRANSPARENCY_DEFAULT }
    const parsed = JSON.parse(raw)
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      transparency:
        parsed.transparency === undefined
          ? TRANSPARENCY_DEFAULT
          : clampTransparency(parsed.transparency),
    }
  } catch {
    return { theme: 'dark', transparency: TRANSPARENCY_DEFAULT }
  }
}

function saveToStorage(state: { theme: Theme; transparency: number }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

// Apply theme + transparency synchronously before React renders to prevent flash
const initial = loadFromStorage()
applyTheme(initial.theme)
applyTransparency(initial.transparency)

export const useAppSettings = create<AppSettingsState>((set, get) => ({
  theme: initial.theme,
  transparency: initial.transparency,

  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
    saveToStorage({ theme, transparency: get().transparency })
  },

  setTransparency: (n) => {
    const transparency = clampTransparency(n)
    set({ transparency })
    applyTransparency(transparency)
    saveToStorage({ theme: get().theme, transparency })
  },
}))
