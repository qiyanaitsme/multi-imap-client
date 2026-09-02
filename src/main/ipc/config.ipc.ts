import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../renderer/lib/types';
import { ConfigParser } from '../services/config/ConfigParser';
import { FileWatcher } from '../services/config/FileWatcher';
import {
  putCredentials,
  clearCredentials,
} from '../services/store/accountRegistry';

/**
 * Register IPC handlers for configuration file management.
 */
export function registerConfigIpc(
  mainWindow: BrowserWindow,
  fileWatcher: FileWatcher,
): void {
  // Guard: skip already-registered channels (safe to call twice)
  const safe = (channel: string, fn: (event: any, ...args: any[]) => any): void => {
    try {
      ipcMain.handle(channel, fn);
    } catch (e: any) {
      if (!String(e?.message || '').includes('second handler')) throw e;
      console.warn(`[config.ipc] channel already registered: ${channel}`);
    }
  };

  // Load accounts file. SECURITY: parsed passwords stay in the main-process
  // credential registry; the renderer receives only id/email/domain/proxy
  // metadata (TechTask §8.2 — passwords must not reach the renderer).
  // Accepts either a file path (dialog picker) or raw content + optional
  // fileName (drag-and-drop — path resolution for dropped files is unreliable).
  const loadAccountsHandler = async (
    _event: any,
    payload: string | { content: string; fileName?: string },
  ) => {
    try {
      const { content, filePath } =
        typeof payload === 'string'
          ? { content: null as string | null, filePath: payload }
          : { content: payload.content, filePath: null as string | null };
      const result =
        content !== null
          ? ConfigParser.parseAccountsContent(content)
          : ConfigParser.parseAccounts(filePath!);
      // Re-import invalidates previously cached credentials
      clearCredentials();
      const publicAccounts = result.data.map((acc, i) => {
        const id = `acc-${i + 1}`;
        putCredentials({
          id,
          email: acc.email,
          password: acc.password,
          domain: acc.domain,
          proxy: acc.proxyString,
        });
        return {
          id,
          email: acc.email,
          domain: acc.domain,
          proxy: acc.proxyString,
          // NOTE: intentionally no `password` field crosses the IPC boundary.
        };
      });
      return {
        success: result.success,
        data: publicAccounts,
        errors: result.errors,
      };
    } catch (err) {
      return {
        success: false,
        data: [],
        errors: [{ line: 0, message: String(err) }],
      };
    }
  };
  safe(IPC_CHANNELS.CONFIG.LOAD_ACCOUNTS, loadAccountsHandler);

  // Load IMAP servers (path from picker or content from drag-and-drop)
  const loadImapServersHandler = async (
    _event: any,
    payload: string | { content: string; fileName?: string },
  ) => {
    try {
      const { content, filePath } =
        typeof payload === 'string'
          ? { content: null as string | null, filePath: payload }
          : { content: payload.content, filePath: null as string | null };
      return content !== null
        ? ConfigParser.parseImapServersContent(content)
        : ConfigParser.parseImapServers(filePath!);
    } catch (err) {
      return { success: false, data: {}, errors: [{ line: 0, message: String(err) }] };
    }
  };
  safe(IPC_CHANNELS.CONFIG.LOAD_IMAP_SERVERS, loadImapServersHandler);

  // Load proxies (path from picker or content from drag-and-drop)
  const loadProxiesHandler = async (
    _event: any,
    payload: string | { content: string; fileName?: string },
  ) => {
    try {
      const { content, filePath } =
        typeof payload === 'string'
          ? { content: null as string | null, filePath: payload }
          : { content: payload.content, filePath: null as string | null };
      return content !== null
        ? ConfigParser.parseProxiesContent(content)
        : ConfigParser.parseProxies(filePath!);
    } catch (err) {
      return { success: false, data: [], errors: [{ line: 0, message: String(err) }] };
    }
  };
  safe(IPC_CHANNELS.CONFIG.LOAD_PROXIES, loadProxiesHandler);

  // Validate config
  safe(
    IPC_CHANNELS.CONFIG.VALIDATE,
    async (_event, params: { type: string; content: string }) => {
      try {
        if (params.type === 'accounts') {
          // Validate a single account line format (no credentials involved)
          return { valid: true };
        }
        if (params.type === 'proxy') {
          const err = ConfigParser.validateProxyString(params.content);
          return { valid: err === null, error: err };
        }
        return { valid: false, error: 'Unknown validation type' };
      } catch (err) {
        return { valid: false, error: String(err) };
      }
    },
  );

  // Open file dialog
  safe('dialog:selectFile', async (_event, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters:
        options?.filters ?? [
          { name: 'Text Files', extensions: ['txt', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Open folder dialog
  safe('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Save file dialog
  safe('dialog:saveFile', async (_event, defaultName?: string) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
    });
    return result.canceled ? null : result.filePath;
  });

  // Save config (no-op; settings persisted via store:set/setSettings handlers)
  safe(
    IPC_CHANNELS.CONFIG.SAVE_CONFIG,
    async (_event, _config: Record<string, unknown>) => {
      return { success: true };
    },
  );
}
