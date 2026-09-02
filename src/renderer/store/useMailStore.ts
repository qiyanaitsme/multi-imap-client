import { create } from 'zustand'
import type { MailMessage, MailContent, MailFolder } from '@/lib/types'

interface MailState {
  // Current folder data
  currentFolder: string | null
  folders: MailFolder[]
  messages: MailMessage[]
  selectedMessageId: string | null
  selectedMessageContent: MailContent | null

  // Loading states
  isFetchingFolders: boolean
  isFetchingMessages: boolean
  isFetchingContent: boolean

  // Pagination
  currentPage: number
  pageSize: number
  totalMessages: number

  // Actions
  setFolders: (folders: MailFolder[]) => void
  setCurrentFolder: (folder: string | null) => void
  setMessages: (messages: MailMessage[], total: number) => void
  setSelectedMessage: (id: string | null) => void
  setSelectedMessageContent: (content: MailContent | null) => void
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  setFetchingFolders: (v: boolean) => void
  setFetchingMessages: (v: boolean) => void
  setFetchingContent: (v: boolean) => void
  markAsRead: (uid: string) => void
}

export const useMailStore = create<MailState>((set) => ({
  currentFolder: 'INBOX',
  folders: [],
  messages: [],
  selectedMessageId: null,
  selectedMessageContent: null,

  isFetchingFolders: false,
  isFetchingMessages: false,
  isFetchingContent: false,

  currentPage: 1,
  pageSize: 50,
  totalMessages: 0,

  setFolders: (folders) => set({ folders }),

  setCurrentFolder: (folder) => set({
    currentFolder: folder,
    messages: [],
    selectedMessageId: null,
    selectedMessageContent: null,
    currentPage: 1,
  }),

  setMessages: (messages, total) => set({ messages, totalMessages: total }),

  setSelectedMessage: (id) => set({ selectedMessageId: id, selectedMessageContent: null }),

  setSelectedMessageContent: (content) => set({ selectedMessageContent: content }),

  setPage: (page) => set({ currentPage: page }),

  setPageSize: (size) => set({ pageSize: size, currentPage: 1 }),

  setFetchingFolders: (v) => set({ isFetchingFolders: v }),

  setFetchingMessages: (v) => set({ isFetchingMessages: v }),

  setFetchingContent: (v) => set({ isFetchingContent: v }),

  markAsRead: (uid) => set((state) => ({
    messages: state.messages.map((m) =>
      m.uid === uid ? { ...m, isRead: true } : m
    ),
  })),
}))