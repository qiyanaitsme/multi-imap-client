/**
 * System tray (IDEAS #17).
 *
 * - Tray icon with context menu: show window / connect all / disconnect all / quit.
 * - Tooltip carries the unread counter pushed from the renderer.
 * - close-to-tray: closing the window hides it instead of quitting
 *   (controlled by electron-store key `closeToTray`, default true).
 */
import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'
import path from 'node:path'
import type { ImapManager } from '../src/main/services/imap/ImapManager'
import { resolveAppIconPath } from './appIcon'

let trayInstance: Tray | null = null

/** 16×16 blue rounded square as base64 PNG — fallback when icon.ico is absent. */
const TRAY_ICON_FALLBACK_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAaElEQVQ4je2SsQ3AIAwEe0xJm5I2JW1K2pS0KWlj0oYs' +
  'gT9YQIKh4B84cMjjPxrW3hnYPPTKZ9IBzKzznHPuHYCq+hzOOWtt3/fRtSnlLrvUbfs+IvXXIr7vXVXTNLXWarVS1/Up' +
  'pbTWGk3THFJKqe97fd8HAPjKP8MDUq0AAAAASUVORK5CYII='

/** Tray icon: the app's icon.ico scaled down, or the embedded fallback. */
function loadTrayIcon(): Electron.NativeImage {
  const iconPath = resolveAppIconPath()
  if (iconPath) {
    const img = nativeImage.createFromPath(iconPath)
    if (!img.isEmpty()) {
      const small = img.resize({ width: 16, height: 16 })
      return small.isEmpty() ? img : small
    }
  }
  console.warn('[tray] icon.ico not found — using embedded fallback icon')
  return nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_FALLBACK_BASE64, 'base64'))
}

export function createTray(
  getWindow: () => BrowserWindow | null,
  imapManager: ImapManager,
): Tray {
  const icon = loadTrayIcon()
  trayInstance = new Tray(icon)
  trayInstance.setToolTip('Multi IMAP Client')

  const rebuildMenu = (): void => {
    if (!trayInstance) return
    const win = getWindow()

    const menu = Menu.buildFromTemplate([
      {
        label: 'Показать окно',
        click: () => {
          const w = getWindow()
          if (w) {
            w.show()
            w.focus()
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Подключить все',
        click: async () => {
          try {
            await imapManager.connectAll()
          } catch (err) {
            console.error('[tray] connectAll failed:', err)
          }
        },
      },
      {
        label: 'Отключить все',
        click: async () => {
          try {
            await imapManager.disconnectAll()
          } catch (err) {
            console.error('[tray] disconnectAll failed:', err)
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          app.quit()
        },
      },
    ])
    void win // window reference kept for future per-account submenus
    trayInstance.setContextMenu(menu)
  }

  rebuildMenu()
  // Rebuild periodically so menu stays valid after account set changes
  setInterval(rebuildMenu, 60_000)

  trayInstance.on('double-click', () => {
    const w = getWindow()
    if (w) {
      w.show()
      w.focus()
    }
  })

  console.log('[tray] created')
  return trayInstance
}

/** Update tooltip unread counter (called via IPC from renderer). */
export function setTrayUnread(count: number): void {
  if (!trayInstance) return
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  trayInstance.setToolTip(n > 0 ? `Multi IMAP Client — ${n} непрочитанных` : 'Multi IMAP Client')
}

export function destroyTray(): void {
  if (trayInstance) {
    trayInstance.destroy()
    trayInstance = null
    console.log('[tray] destroyed')
  }
}
