import { BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'

// electron-updater is CommonJS: Node's ESM loader cannot statically detect
// its named exports, so we MUST go through the default export here.
// (tsc accepts named imports thanks to esModuleInterop, but the runtime
// throws "Named export 'autoUpdater' not found" — verified in dev.)
const { autoUpdater } = electronUpdater

/**
 * Wire up auto-updates via electron-updater.
 *
 * Behavior:
 *  - Skipped entirely in development (no packaged app / update feed).
 *  - Checks on startup, then forwards progress/availability to the renderer
 *    over the 'updater:status' channel so the UI can show a toast/banner.
 *  - Does NOT auto-install silently; the renderer decides when to trigger
 *    quitAndInstall via the 'updater:install' IPC channel.
 */
export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  // Register IPC handlers unconditionally so the renderer can call them even in
  // dev (where they become safe no-ops). Registering only after the dev guard
  // below caused "No handler registered" errors during development.
  const isDev = !!process.env['ELECTRON_RENDERER_URL']

  ipcMain.handle('updater:install', () => {
    if (isDev) return
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updater:check', () => {
    if (isDev) return null
    return autoUpdater.checkForUpdates().catch(() => null)
  })

  // In dev electron-vite sets ELECTRON_RENDERER_URL and there's no update feed
  // or packaged app — skip the rest of the updater wiring entirely.
  if (isDev) {
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (payload: Record<string, unknown>): void => {
    const win = getWindow()
    win?.webContents.send('updater:status', payload)
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    send({ state: 'available', version: info.version }),
  )
  autoUpdater.on('update-not-available', () => send({ state: 'up-to-date' }))
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'downloading', percent: Math.round(p.percent) }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    send({ state: 'downloaded', version: info.version }),
  )
  autoUpdater.on('error', (err) =>
    send({ state: 'error', message: err?.message ?? String(err) }),
  )

  // Initial check shortly after launch (don't block window creation).
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      /* offline or no feed configured — ignore */
    })
  }, 3000)
}
