import { create } from 'zustand'

type Theme = 'light' | 'dark'

interface SettingsState {
  compactMode: boolean
  pageSize: 30 | 50 | 100
  autoDisconnectMinutes: number
  maxConnections: number
  connectionTimeoutSeconds: number
  language: 'ru' | 'en'
  theme: Theme
  loaded: boolean

  setCompactMode: (v: boolean) => void
  setPageSize: (size: 30 | 50 | 100) => void
  setAutoDisconnectMinutes: (m: number) => void
  setMaxConnections: (n: number) => void
  setConnectionTimeoutSeconds: (s: number) => void
  setLanguage: (lang: 'ru' | 'en') => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  /** Load persisted settings from electron-store on app startup. */
  loadSettings: () => Promise<void>
}

// Keys persisted to electron-store (main process reads these for ImapManager tuning).
const PERSIST_KEYS = [
  'compactMode',
  'pageSize',
  'autoDisconnectMinutes',
  'maxConnections',
  'connectionTimeoutSeconds',
  'language',
  'theme',
] as const

/** Apply the theme by toggling the `.dark` class on <html> (Tailwind darkMode: class). */
function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

/** Persist a single setting to electron-store (main process). Non-blocking. */
function persist(partial: Record<string, unknown>): void {
  window.electronAPI?.setSettings(partial).catch(() => {
    /* ignore persistence errors — settings still apply in-session */
  })
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  compactMode: false,
  pageSize: 50,
  autoDisconnectMinutes: 5,
  maxConnections: 50,
  connectionTimeoutSeconds: 30,
  language: 'ru',
  theme: 'dark',
  loaded: false,

  setCompactMode: (v) => {
    set({ compactMode: v })
    persist({ compactMode: v })
  },
  setPageSize: (size) => {
    set({ pageSize: size })
    persist({ pageSize: size })
  },
  setAutoDisconnectMinutes: (m) => {
    set({ autoDisconnectMinutes: m })
    persist({ autoDisconnectMinutes: m })
  },
  setMaxConnections: (n) => {
    set({ maxConnections: n })
    persist({ maxConnections: n })
  },
  setConnectionTimeoutSeconds: (s) => {
    set({ connectionTimeoutSeconds: s })
    persist({ connectionTimeoutSeconds: s })
  },
  setLanguage: (lang) => {
    set({ language: lang })
    persist({ language: lang })
  },
  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    persist({ theme })
  },
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    set({ theme: next })
    persist({ theme: next })
  },

  loadSettings: async () => {
    if (get().loaded) return
    try {
      const stored = (await window.electronAPI?.getSettings()) as Record<string, unknown> | undefined
      if (stored) {
        const next: Partial<SettingsState> = {}
        for (const key of PERSIST_KEYS) {
          if (stored[key] !== undefined) {
            ;(next as Record<string, unknown>)[key] = stored[key]
          }
        }
        set({ ...next, loaded: true })
        // Apply the persisted (or default) theme to the DOM.
        applyTheme((next.theme as Theme) ?? get().theme)
      } else {
        set({ loaded: true })
        applyTheme(get().theme)
      }
    } catch {
      set({ loaded: true })
      applyTheme(get().theme)
    }
  },
}))
