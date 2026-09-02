import { create } from 'zustand'
import type { ParsedProxy } from '@/lib/types'

interface ProxyState {
  proxies: ParsedProxy[]
  isChecking: boolean
  checkedAt: string | null

  // Actions
  setProxies: (proxies: ParsedProxy[]) => void
  addProxy: (proxy: ParsedProxy) => void
  removeProxy: (raw: string) => void
  updateProxyStatus: (raw: string, status: 'alive' | 'dead') => void
  setChecking: (v: boolean) => void
  setCheckedAt: (date: string) => void
}

export const useProxyStore = create<ProxyState>((set) => ({
  proxies: [],
  isChecking: false,
  checkedAt: null,

  setProxies: (proxies) => set({ proxies }),

  addProxy: (proxy) => set((state) => ({
    proxies: [...state.proxies.filter((p) => p.raw !== proxy.raw), proxy],
  })),

  removeProxy: (raw) => set((state) => ({
    proxies: state.proxies.filter((p) => p.raw !== raw),
  })),

  updateProxyStatus: (raw, status) => set((state) => ({
    proxies: state.proxies.map((p) =>
      p.raw === raw ? { ...p, status } : p
    ),
  })),

  setChecking: (v) => set({ isChecking: v }),

  setCheckedAt: (date) => set({ checkedAt: date }),
}))