import { BrowserWindow } from 'electron'
import { ImapManager } from '../services/imap/ImapManager'
import { FileWatcher } from '../services/config/FileWatcher'
import { registerConfigIpc } from './config.ipc'
import { registerAccountsIpc } from './accounts.ipc'
import { registerMailIpc } from './mail.ipc'
import { registerProxyIpc } from './proxy.ipc'

/**
 * Register all IPC handlers.
 * Called once during app initialization.
 */
export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  imapManager: ImapManager,
  fileWatcher: FileWatcher,
): void {
  registerConfigIpc(mainWindow, fileWatcher)
  registerAccountsIpc(mainWindow, imapManager)
  registerMailIpc(mainWindow, imapManager)
  registerProxyIpc(mainWindow)
}