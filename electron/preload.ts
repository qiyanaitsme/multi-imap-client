import { contextBridge, ipcRenderer, webUtils, IpcRendererEvent } from 'electron'

export interface ElectronAPI {
  // File operations
  selectFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>
  selectFolder: () => Promise<string | null>
  saveFile: (defaultPath?: string) => Promise<string | null>
  getPathForFile: (file: File) => string

  // Config methods (need filePath argument)
  loadAccounts: (filePath: string) => Promise<any>
  loadImapServers: (filePath: string) => Promise<any>
  loadProxies: (filePath: string) => Promise<any>
  /** Drag-and-drop variants: parse file CONTENT read in the renderer. */
  loadAccountsContent: (content: string, fileName?: string) => Promise<any>
  loadImapServersContent: (content: string, fileName?: string) => Promise<any>
  loadProxiesContent: (content: string, fileName?: string) => Promise<any>
  saveConfig: (config: Record<string, unknown>) => Promise<void>
  validate: (type: string, content: string) => Promise<any>

  // Account registration (so main process can connect them later)
  registerAccount: (account: {
    id: string
    email: string
    domain: string
    proxy: string | null
  }) => Promise<any>
  clearAccounts: () => Promise<any>

  // Account methods
  connectAccount: (accountId: string) => Promise<any>
  disconnectAccount: (accountId: string) => Promise<any>
  connectAll: () => Promise<any>
  disconnectAll: () => Promise<any>
  reconnectAll: () => Promise<any>
  getAccountStatus: (accountId: string) => Promise<any>
  assignProxy: (accountId: string, proxyString: string | null) => Promise<any>
  massAssignProxy: (accountIds: string[], proxyString: string | null) => Promise<any>

  // Mail methods
  fetchFolders: (accountId: string) => Promise<any>
  fetchMails: (accountId: string, folder: string, options?: any) => Promise<any>
  fetchMailContent: (accountId: string, uid: string) => Promise<any>
  searchMails: (accountId: string, query: string) => Promise<any>
  saveAttachment: (accountId: string, uid: string, attachmentId: string) => Promise<any>
  exportMail: (params: {
    accountId: string
    uid: string
    format: 'eml' | 'html' | 'txt'
    content?: string
    suggestedName?: string
  }) => Promise<any>
  markRead: (accountId: string, uid: string) => Promise<any>

  // Proxy methods
  getProxies: () => Promise<any>
  checkProxy: (proxyString: string) => Promise<any>
  checkAllProxies: () => Promise<any>

  // Store methods (electron-store)
  getSettings: () => Promise<Record<string, unknown>>
  setSettings: (settings: Record<string, unknown>) => Promise<void>
  getSecure: (key: string) => Promise<string | null>

  // Safe storage
  encryptSafe: (plainText: string) => Promise<string>
  decryptSafe: (encryptedBase64: string) => Promise<string>
  isEncryptionAvailable: () => Promise<boolean>

  // Window controls
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  close: () => Promise<void>
  /** Update tray tooltip unread counter (IDEAS #17). */
  updateTrayBadge: (count: number) => Promise<void>

  // Shell — open a URL in the default external browser
  openExternal: (url: string) => Promise<void>

  // Auto-updater
  checkForUpdates: () => Promise<void>
  installUpdate: () => Promise<void>

  // Event listeners (IPC)
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  off: (channel: string, callback: (...args: unknown[]) => void) => void
}

/**
 * Channels the renderer is allowed to subscribe to via on()/off().
 * SECURITY (Electron #15): never expose ipcRenderer without a channel
 * allow-list — a compromised renderer must not be able to listen to
 * arbitrary IPC traffic or register on invoke-only channels.
 */
const PUSH_CHANNELS: ReadonlySet<string> = new Set([
  'accounts:status-changed', // ImapManager status pushes
  'updater:status', // auto-update progress/availability
])
const electronAPI: ElectronAPI = {
  // File operations — channels match main.ts handlers
  selectFile: (options) => ipcRenderer.invoke('dialog:selectFile', options),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  saveFile: (defaultPath) => ipcRenderer.invoke('dialog:saveFile', defaultPath),
  // Resolve real OS path for a dropped File object (Electron 31+ replacement for File.path)
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Config methods — channels match config.ipc.ts handlers (IPC_CHANNELS)
  loadAccounts: (filePath) => ipcRenderer.invoke('config:load-accounts', filePath),
  loadImapServers: (filePath) => ipcRenderer.invoke('config:load-imap-servers', filePath),
  loadProxies: (filePath) => ipcRenderer.invoke('config:load-proxies', filePath),
  // Drag-and-drop: send CONTENT — webUtils.getPathForFile is unreliable in
  // Electron 31 (returns '' for Files bridged from the renderer).
  loadAccountsContent: (content, fileName) =>
    ipcRenderer.invoke('config:load-accounts', { content, fileName }),
  loadImapServersContent: (content, fileName) =>
    ipcRenderer.invoke('config:load-imap-servers', { content, fileName }),
  loadProxiesContent: (content, fileName) =>
    ipcRenderer.invoke('config:load-proxies', { content, fileName }),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  validate: (type, content) => ipcRenderer.invoke('config:validate', { type, content }),

  // Account registration (so main process can connect them later)
  registerAccount: (account) => ipcRenderer.invoke('accounts:register', account),
  clearAccounts: () => ipcRenderer.invoke('accounts:clear'),

  // Account methods — channels match accounts.ipc.ts
  connectAccount: (accountId) => ipcRenderer.invoke('accounts:connect', accountId),
  disconnectAccount: (accountId) => ipcRenderer.invoke('accounts:disconnect', accountId),
  connectAll: () => ipcRenderer.invoke('accounts:connect-all'),
  disconnectAll: () => ipcRenderer.invoke('accounts:disconnect-all'),
  reconnectAll: () => ipcRenderer.invoke('accounts:reconnect-all'),
  getAccountStatus: (accountId) => ipcRenderer.invoke('accounts:get-status', accountId),
  assignProxy: (accountId, proxyString) => ipcRenderer.invoke('accounts:assign-proxy', accountId, proxyString),
  massAssignProxy: (accountIds, proxyString) =>
    ipcRenderer.invoke('accounts:mass-assign-proxy', accountIds, proxyString),

  // Mail methods — channels match mail.ipc.ts
  fetchFolders: (accountId) => ipcRenderer.invoke('mail:fetch-folders', accountId),
  fetchMails: (accountId, folder, options) =>
    ipcRenderer.invoke('mail:fetch-messages', { accountId, folder, ...options }),
  fetchMailContent: (accountId, uid) =>
    ipcRenderer.invoke('mail:fetch-content', accountId, uid),
  searchMails: (accountId, query) => ipcRenderer.invoke('mail:search', accountId, query),
  saveAttachment: (accountId, uid, attachmentId) =>
    ipcRenderer.invoke('mail:save-attachment', accountId, uid, attachmentId),
  exportMail: (params) => ipcRenderer.invoke('mail:export', params),
  markRead: (accountId, uid) => ipcRenderer.invoke('mail:mark-read', accountId, uid),

  // Proxy methods — channels match proxy.ipc.ts
  getProxies: () => ipcRenderer.invoke('proxy:get-all'),
  checkProxy: (proxyString) => ipcRenderer.invoke('proxy:check', proxyString),
  checkAllProxies: () => ipcRenderer.invoke('proxy:check-all'),

  // Store methods (electron-store)
  getSettings: () => ipcRenderer.invoke('store:getSettings'),
  setSettings: (settings) => ipcRenderer.invoke('store:setSettings', settings),
  getSecure: (key) => ipcRenderer.invoke('store:getSecure', key),

  // Safe storage
  encryptSafe: (plainText) => ipcRenderer.invoke('safeStorage:encrypt', plainText),
  decryptSafe: (encryptedBase64) => ipcRenderer.invoke('safeStorage:decrypt', encryptedBase64),
  isEncryptionAvailable: () => ipcRenderer.invoke('safeStorage:isAvailable'),

  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  updateTrayBadge: (count) => ipcRenderer.invoke('tray:update-badge', count),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  // Event listeners
  on: (channel, callback) => {
    if (!PUSH_CHANNELS.has(channel)) {
      console.warn(`[preload] Subscription to channel '${channel}' is not allowed`)
      return () => {}
    }
    const handler = (_event: IpcRendererEvent, ...args: unknown[]): void => {
      callback(...args)
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  },
  off: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!PUSH_CHANNELS.has(channel)) return
    ipcRenderer.removeListener(channel, callback as (...args: unknown[]) => void)
  },

}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}