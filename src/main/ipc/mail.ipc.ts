import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { IPC_CHANNELS } from '../../renderer/lib/types'
import { ImapManager } from '../services/imap/ImapManager'

function safeHandle(channel: string, fn: (event: any, ...args: any[]) => any): void {
  try {
    ipcMain.handle(channel, fn)
  } catch (e: any) {
    if (!String(e?.message || '').includes('second handler')) throw e
    console.warn(`[mail.ipc] channel already registered: ${channel}`)
  }
}

export function registerMailIpc(
  mainWindow: BrowserWindow,
  imapManager: ImapManager,
): void {
  // Fetch folders for an account
  safeHandle(IPC_CHANNELS.MAIL.FETCH_FOLDERS, async (_event, accountId: string) => {
    try {
      const folders = await imapManager.fetchFolders(accountId)
      return { success: true, data: folders }
    } catch (err) {
      return { success: false, error: String(err), data: [] }
    }
  })

  // Fetch messages — receives object { accountId, folder, page?, pageSize?, searchQuery? }
  safeHandle(
    IPC_CHANNELS.MAIL.FETCH_MESSAGES,
    async (
      _event,
      params: {
        accountId: string
        folder: string
        page?: number
        pageSize?: number
        sortOrder?: 'asc' | 'desc'
        searchQuery?: string
      },
    ) => {
      try {
        const result = await imapManager.fetchMessages(params.accountId, params.folder, {
          page: params.page,
          pageSize: params.pageSize,
          sortOrder: params.sortOrder,
          searchQuery: params.searchQuery,
        })
        return { success: true, ...result }
      } catch (err) {
        return { success: false, error: String(err), messages: [], total: 0 }
      }
    },
  )

  // Fetch message content — receives (accountId, uid)
  safeHandle(IPC_CHANNELS.MAIL.FETCH_CONTENT, async (_event, accountId: string, uid: string) => {
    try {
      const content = await imapManager.fetchMessageContent(accountId, uid)
      // Auto-mark as read
      await imapManager.markAsRead(accountId, uid)
      return { success: true, data: content }
    } catch (err) {
      return { success: false, error: String(err), data: null }
    }
  })

  // Search messages — receives (accountId, query)
  safeHandle(IPC_CHANNELS.MAIL.SEARCH, async (_event, accountId: string, query: string) => {
    try {
      const results = await imapManager.searchMessages(accountId, query)
      return { success: true, data: results }
    } catch (err) {
      return { success: false, error: String(err), data: [] }
    }
  })

  // Mark message as read
  safeHandle(IPC_CHANNELS.MAIL.MARK_READ, async (_event, accountId: string, uid: string) => {
    try {
      await imapManager.markAsRead(accountId, uid)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Save a single attachment to disk — fetches the raw binary bytes from IMAP,
  // shows a native save dialog, then writes the file.
  safeHandle(
    IPC_CHANNELS.MAIL.SAVE_ATTACHMENT,
    async (_event, accountId: string, uid: string, attachmentId: string) => {
      try {
        const attachment = await imapManager.getAttachmentData(accountId, uid, attachmentId)

        const saveResult = await dialog.showSaveDialog(mainWindow, {
          defaultPath: attachment.filename,
          filters: [{ name: 'All Files', extensions: ['*'] }],
        })

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: false, error: 'Save cancelled' }
        }

        await writeFile(saveResult.filePath, attachment.data)
        return { success: true, savedPath: saveResult.filePath }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )

  // Export a message to disk as .eml (raw source), .html or .txt.
  // For html/txt the renderer passes the already-built body; for eml we fetch
  // the raw RFC822 source from IMAP.
  safeHandle(
    'mail:export',
    async (
      _event,
      params: {
        accountId: string
        uid: string
        format: 'eml' | 'html' | 'txt'
        content?: string
        suggestedName?: string
      },
    ) => {
      try {
        const { accountId, uid, format } = params
        const ext = format
        const defaultName = (params.suggestedName || `message-${uid}`).replace(/[\\/:*?"<>|]/g, '_')

        const saveResult = await dialog.showSaveDialog(mainWindow, {
          defaultPath: `${defaultName}.${ext}`,
          filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        })
        if (saveResult.canceled || !saveResult.filePath) {
          return { success: false, error: 'Save cancelled' }
        }

        if (format === 'eml') {
          const raw = await imapManager.getRawMessage(accountId, uid)
          await writeFile(saveResult.filePath, raw)
        } else {
          await writeFile(saveResult.filePath, params.content ?? '', 'utf-8')
        }

        return { success: true, savedPath: saveResult.filePath }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    },
  )
}