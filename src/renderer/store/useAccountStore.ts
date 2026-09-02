import { create } from 'zustand'
import type { AccountStatus, Account } from '@/lib/types'

export type { Account }

interface AccountState {
  accounts: Account[]
  selectedAccountId: string | null

  // Actions
  setAccounts: (accounts: Account[]) => void
  addAccount: (account: Account) => void
  removeAccount: (id: string) => void
  updateAccountStatus: (id: string, status: AccountStatus, error?: string) => void
  setSelectedAccount: (id: string | null) => void
  getAccountById: (id: string) => Account | undefined
  getOnlineCount: () => number
  getErrorCount: () => number
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  selectedAccountId: null,

  setAccounts: (accounts) => set({ accounts }),

  addAccount: (account) => set((state) => ({
    accounts: [...state.accounts, account],
  })),

  removeAccount: (id) => set((state) => ({
    accounts: state.accounts.filter((a) => a.id !== id),
    selectedAccountId: state.selectedAccountId === id ? null : state.selectedAccountId,
  })),

  updateAccountStatus: (id, status, error) => set((state) => ({
    accounts: state.accounts.map((a) =>
      a.id === id ? { ...a, status, error: error ?? a.error } : a
    ),
  })),

  setSelectedAccount: (id) => set({ selectedAccountId: id }),

  getAccountById: (id) => get().accounts.find((a) => a.id === id),

  getOnlineCount: () => get().accounts.filter((a) => a.status === 'online').length,

  getErrorCount: () => get().accounts.filter((a) => a.status === 'error').length,
}))