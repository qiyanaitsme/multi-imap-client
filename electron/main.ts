import { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { existsSync, mkdirSync, appendFileSync } from 'fs'
import { ImapManager } from '../src/main/services/imap/ImapManager'
import { FileWatcher } from '../src/main/services/config/FileWatcher'
import { ConfigParser } from '../src/main/services/config/ConfigParser'
import { setProxyPool } from '../src/main/ipc/proxy.ipc'
import { registerIpcHandlers } from '../src/main/ipc'
import { initAutoUpdater } from './updater'
import { createTray, setTrayUnread, destroyTray } from './tray'
import { resolveAppIconPath } from './appIcon'
import type { ImapServerConfig, ParsedProxy } from '../src/renderer/lib/types'

/**
 * Last-resort safety net for the main process.
 * Network libraries (imapflow, socks, net) can emit late socket errors on
 * EventEmitters we no longer control; without these handlers Node turns any
 * unhandled 'error' event into an uncaughtException and Electron kills the app
 * with "A JavaScript error occurred in the main process".
 * We LOG and keep running; only truly fatal bootstrap errors terminate.
 */
function installProcessGuards(): void {
  const logsDir = join(app.getPath('userData'), 'logs')
  let logFile: string | null = null
  const writeLog = (line: string): void => {
    try {
      if (!logFile) {
        if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true })
        logFile = join(logsDir, 'main.log')
      }
      appendFileSync(logFile, `[${new Date().toISOString()}] ${line}` + '\n', 'utf8')
    } catch {
      // Logging must never throw
    }
  }

  process.on('uncaughtException', (err: Error) => {
    const msg = `uncaughtException: ${err.stack ?? err.message}`
    console.error(msg)
    writeLog(msg)
    // Fatal conditions that make the process state unusable:
    if (err.message.includes('ERR_MODULE_NOT_FOUND') || err.message.includes('NOMEM')) {
      dialog.showErrorBox('Критическая ошибка', err.stack ?? err.message)
      app.quit()
    }
  })

  process.on('unhandledRejection', (reason: unknown) => {
    const msg =
      reason instanceof Error
        ? `unhandledRejection: ${reason.stack ?? reason.message}`
        : `unhandledRejection: ${String(reason)}`
    console.error(msg)
    writeLog(msg)
  })
}

installProcessGuards()

let mainWindow: BrowserWindow | null = null

// Electron store for window bounds and app settings
const store = new Store<{
  windowBounds: { x: number; y: number; width: number; height: number }
}>({
  defaults: {
    windowBounds: { x: -1, y: -1, width: 1400, height: 900 },
  },
})

// Singletons for main process
let imapManager: ImapManager
let fileWatcher: FileWatcher

function createWindow(): BrowserWindow {
  const bounds = (store as any).get('windowBounds', {
    x: -1,
    y: -1,
    width: 1400,
    height: 900,
  }) as { x: number; y: number; width: number; height: number }

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: bounds.width,
    height: bounds.height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    title: 'Multi IMAP Client',
    autoHideMenuBar: true,
    backgroundColor: '#1e1e2e',
    icon: resolveAppIconPath() || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, '..', 'preload', 'index.cjs'),
    },
  }

  if (bounds.x !== -1 && bounds.y !== -1) {
    Object.assign(windowOptions, { x: bounds.x, y: bounds.y })
  }

  mainWindow = new BrowserWindow(windowOptions)

  // Save window bounds on move and resize
  const saveBounds = (): void => {
    if (!mainWindow) return
    const b = mainWindow.getBounds()
    ;(store as any).set('windowBounds', { x: b.x, y: b.y, width: b.width, height: b.height })
  }

  mainWindow.on('resize', saveBounds)
  mainWindow.on('move', saveBounds)
    // Close-to-tray (IDEAS #17): hide instead of quitting unless user opted out.
  let isQuitting = false
  app.on('before-quit', () => {
    isQuitting = true
  })
  mainWindow.on('close', (e) => {
    const closeToTray = (store as any).get('closeToTray', true)
    if (!isQuitting && closeToTray && mainWindow && !mainWindow.isDestroyed()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

mainWindow.on('close', saveBounds)

  // Load renderer (dev server URL or production file)
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    // DevTools no longer auto-opens on dev launch — press F12 (or Ctrl+Shift+I)
    // to toggle it manually when needed.
  } else {
    // __dirname is out/main; renderer is emitted to out/renderer (sibling dir).
    // The previous '../out/renderer' resolved to out/main/out/renderer (wrong)
    // and produced a blank white screen in packaged builds.
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

// Window control IPC handlers
function registerWindowControlIpc(): void {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
}

// Open a URL in the user's default browser (used for links inside emails).
// Only http/https/mailto are allowed to prevent launching arbitrary protocols.
function registerShellIpc(): void {
  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    try {
      const parsed = new URL(url)
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        return shell.openExternal(url)
      }
    } catch {
      // invalid URL — ignore
    }
    return undefined
  })
}

// Encryption handlers using safeStorage
function registerSecureStorageIpc(): void {
  ipcMain.handle('safeStorage:encrypt', (_event, plainText: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this platform')
    }
    return safeStorage.encryptString(plainText).toString('base64')
  })

  ipcMain.handle('safeStorage:decrypt', (_event, encryptedBase64: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available on this platform')
    }
    return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'))
  })

  ipcMain.handle('safeStorage:isAvailable', () => safeStorage.isEncryptionAvailable())
}

// Keys the renderer may read/write via store:* IPC. SECURITY:
// without this allow-list a compromised renderer could overwrite
// arbitrary electron-store keys (e.g. windowBounds) or probe values.
const ALLOWED_STORE_KEYS: ReadonlySet<string> = new Set([
  'windowBounds',
  'compactMode',
  'pageSize',
  'autoDisconnectMinutes',
  'maxConnections',
  'connectionTimeoutSeconds',
  'language',
  'theme',
  'closeToTray',
  'imapServers',
  'proxies',
])

function isAllowedStoreKey(key: string): boolean {
  return typeof key === 'string' && ALLOWED_STORE_KEYS.has(key)
}

// Store IPC handlers
function registerStoreIpc(imapManager: ImapManager): void {
  ipcMain.handle('store:set', (_event, key: string, value: unknown) => {
    if (!isAllowedStoreKey(key)) return { success: false, error: 'Key not allowed' }
    ;(store as any).set(key, value)
    syncSettingsToImapManager(imapManager)
    return { success: true }
  })

  ipcMain.handle('store:get', (_event, key: string, defaultValue?: unknown) => {
    if (!isAllowedStoreKey(key)) return defaultValue
    return (store as any).get(key, defaultValue)
  })

  ipcMain.handle('store:delete', (_event, key: string) => {
    if (!isAllowedStoreKey(key)) return { success: false, error: 'Key not allowed' }
    ;(store as any).delete(key)
    return { success: true }
  })

  ipcMain.handle('store:getSettings', () => {
    const all = (store as any).store as Record<string, unknown>
    const filtered: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(all)) {
      if (isAllowedStoreKey(k)) filtered[k] = v
    }
    return filtered
  })

  ipcMain.handle('store:setSettings', (_event, settings: Record<string, unknown>) => {
    // Reject non-object payloads before spreading (prototype-pollution guard)
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return { success: false, error: 'Invalid settings payload' }
    }
    // Merge (shallow) instead of full replace: preserves windowBounds and
    // other existing keys the caller didn't include.
    const current = (store as any).store as Record<string, unknown>
    const safeSettings: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(settings)) {
      if (isAllowedStoreKey(k) && k !== '__proto__' && k !== 'constructor') {
        safeSettings[k] = v
      }
    }
    ;(store as any).store = { ...current, ...safeSettings }
    syncSettingsToImapManager(imapManager)
    return { success: true }
  })

  ipcMain.handle('store:getSecure', (_event, key: string) => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Encryption is not available')
    }
    const encrypted = (store as any).get(key) as string | undefined
    if (!encrypted) return null
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  })
}

/**
 * Sync imap-servers and proxies from electron-store into ImapManager so
 * connectAccount() can resolve them. Called after every store mutation.
 */
function syncSettingsToImapManager(imapManager: ImapManager): void {
  try {
    const all = (store as any).store as Record<string, unknown>

    // Runtime tuning — connection limits / timeouts from the Settings panel.
    imapManager.setTuning({
      maxConnections: typeof all.maxConnections === 'number' ? all.maxConnections : undefined,
      autoDisconnectMinutes:
        typeof all.autoDisconnectMinutes === 'number' ? all.autoDisconnectMinutes : undefined,
      connectionTimeoutSeconds:
        typeof all.connectionTimeoutSeconds === 'number' ? all.connectionTimeoutSeconds : undefined,
    })

    // IMAP servers — stored as { domain: { host, port, tls } }
    // Only update if non-empty; an empty object would clear the config
    // and force auto-detection (imap.{domain}:993) which is almost always wrong.
    if (all.imapServers && typeof all.imapServers === 'object') {
      const servers = all.imapServers as Record<string, ImapServerConfig>
      const serverCount = Object.keys(servers).length
      if (serverCount > 0) {
        imapManager.setImapServers(servers)
        console.log(`[sync] IMAP servers synced: ${serverCount} entries`)
      } else {
        console.warn('[sync] imapServers is empty — keeping previous config')
      }
    }

    // Proxies — stored as string[] from renderer; parse each into ParsedProxy
    if (Array.isArray(all.proxies)) {
      const proxies: ParsedProxy[] = []
  const seenRaw = new Set<string>()
      for (const raw of all.proxies as string[]) {
        try {
            {
          const parsed = ConfigParser.parseProxyString(raw)
          if (!seenRaw.has(parsed.raw)) {
            seenRaw.add(parsed.raw)
            proxies.push(parsed)
          }
        }
        } catch {
          console.warn(`[sync] Skipping invalid proxy: ${raw}`)
        }
      }

      // Also sync to proxy.ipc state for proxy:check-all
      setProxyPool(proxies)

      // And to ImapManager for account connections
      imapManager.setProxyPool(proxies)
      console.log(`[sync] Proxies synced: ${proxies.length} entries`)
    }
  } catch (err) {
    console.error('[sync] Failed to sync settings to ImapManager:', err)
  }
}

app.whenReady().then(() => {
  // Windows taskbar/notifications identity — must match electron-builder appId
  app.setAppUserModelId('com.multi-imap-client.app')

  // Initialize services
  imapManager = new ImapManager(50, 5)
  fileWatcher = new FileWatcher(5000)

  // Register window controls
  registerWindowControlIpc()

  // Register secure storage
  registerSecureStorageIpc()

  // Register shell (open external links)
  registerShellIpc()

  // Register store handlers (needs imapManager to sync imap servers + proxy pool)
  registerStoreIpc(imapManager)

  // Create main window first (so IPC handlers can reference it)
  mainWindow = createWindow()

  // Register business logic IPC handlers (build, accounts, mail, proxy, dialog)
  registerIpcHandlers(mainWindow, imapManager, fileWatcher)
  // System tray with unread badge tooltip (IDEAS #17)
  ipcMain.handle('tray:update-badge', (_event: unknown, count: number) => {
    setTrayUnread(count)
    return { success: true }
  })
  createTray(() => mainWindow, imapManager)

  // Sync persisted settings (imap-servers.json + proxies.txt from last run) into ImapManager
  syncSettingsToImapManager(imapManager)

  // Auto-updates (no-op in dev; checks + downloads in packaged builds)
  initAutoUpdater(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Cleanup on quit
app.on('before-quit', async () => {
  destroyTray()
  if (imapManager) {
    await imapManager.destroy()
  }
  if (fileWatcher) {
    fileWatcher.unwatchAll()
  }
})

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}