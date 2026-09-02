import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../renderer/lib/types';
import { ImapManager } from '../services/imap/ImapManager';
import type { Account } from '../../renderer/lib/types';
import { getCredentials } from '../services/store/accountRegistry';

// Safe wrapper: skip "second handler" errors when registrations happen twice
function safeHandle(channel: string, fn: (event: any, ...args: any[]) => any): void {
  try {
    ipcMain.handle(channel, fn);
  } catch (e: any) {
    if (!String(e?.message || '').includes('second handler')) throw e;
    console.warn(`[accounts.ipc] channel already registered: ${channel}`);
  }
}

/**
 * Payload sent by the renderer when registering an account.
 * SECURITY: contains NO password — credentials are resolved main-side
 * from the account registry populated by config:load-accounts.
 */
interface RegisterAccountPayload {
  id: string;
  email: string;
  domain: string;
  proxy: string | null;
}

export function registerAccountsIpc(
  _mainWindow: BrowserWindow,
  imapManager: ImapManager,
): void {
  // Register a single account. The password never crosses the IPC boundary:
  // it is looked up in the main-process credential cache by id.
  safeHandle('accounts:register', async (_event, payload: RegisterAccountPayload) => {
    try {
      const cred = getCredentials(payload.id);
      if (!cred) {
        return { success: false, error: `No credentials cached for ${payload.id}` };
      }
      const account: Account = {
        id: payload.id,
        email: payload.email || cred.email,
        password: cred.password,
        domain: payload.domain || cred.domain,
        status: 'offline',
        proxy: payload.proxy ?? cred.proxy,
      };
      imapManager.registerAccount(account);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Clear all registered accounts (called on re-import)
  safeHandle('accounts:clear', async () => {
    try {
      // Disconnect and remove all registered accounts
      await imapManager.clearAccounts();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Connect single account
  safeHandle(IPC_CHANNELS.ACCOUNTS.CONNECT, async (event, accountId: string) => {
    try {
      await imapManager.connectAccount(accountId);
      const status = imapManager.getAccountStatus(accountId);
      event.sender.send(IPC_CHANNELS.ACCOUNTS.STATUS_CHANGED, {
        accountId,
        status,
        error: null,
      });
      return { success: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      event.sender.send(IPC_CHANNELS.ACCOUNTS.STATUS_CHANGED, {
        accountId,
        status: 'error',
        error: errorMsg,
      });
      return { success: false, error: errorMsg };
    }
  });

  // Disconnect single account
  safeHandle(IPC_CHANNELS.ACCOUNTS.DISCONNECT, async (event, accountId: string) => {
    try {
      await imapManager.disconnectAccount(accountId);
      event.sender.send(IPC_CHANNELS.ACCOUNTS.STATUS_CHANGED, {
        accountId,
        status: 'offline',
        error: null,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Connect all sequentially by domain, sends status updates as each account connects
  safeHandle(IPC_CHANNELS.ACCOUNTS.CONNECT_ALL, async (event) => {
    try {
      // Wire ImapManager events so event.sender.send gets live updates
      const onConnected = (accountId: string): void => {
        event.sender.send(IPC_CHANNELS.ACCOUNTS.STATUS_CHANGED, {
          accountId,
          status: imapManager.getAccountStatus(accountId),
          error: null,
        });
      };

      const onError = (accountId: string, error: string): void => {
        event.sender.send(IPC_CHANNELS.ACCOUNTS.STATUS_CHANGED, {
          accountId,
          status: 'error',
          error,
        });
      };

      imapManager.on('account:connected', onConnected);
      imapManager.on('account:error', onError);

      await imapManager.connectAll();

      // Push final snapshot
      for (const s of imapManager.getAllStatuses()) {
        event.sender.send(IPC_CHANNELS.ACCOUNTS.STATUS_CHANGED, {
          accountId: s.accountId,
          status: s.status,
          error: s.error,
        });
      }

      // Cleanup listeners
      imapManager.off('account:connected', onConnected);
      imapManager.off('account:error', onError);

      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Disconnect all
  safeHandle(IPC_CHANNELS.ACCOUNTS.DISCONNECT_ALL, async (event) => {
    try {
      await imapManager.disconnectAll();
      for (const s of imapManager.getAllStatuses()) {
        event.sender.send(IPC_CHANNELS.ACCOUNTS.STATUS_CHANGED, {
          accountId: s.accountId,
          status: 'offline',
          error: null,
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Reconnect all
  safeHandle(IPC_CHANNELS.ACCOUNTS.RECONNECT_ALL, async (event) => {
    try {
      await imapManager.reconnectAll();
      for (const s of imapManager.getAllStatuses()) {
        event.sender.send(IPC_CHANNELS.ACCOUNTS.STATUS_CHANGED, {
          accountId: s.accountId,
          status: s.status,
          error: s.error,
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // Get account status
  safeHandle(IPC_CHANNELS.ACCOUNTS.GET_STATUS, async (_event, accountId: string) => {
    try {
      return { status: imapManager.getAccountStatus(accountId) };
    } catch (err) {
      return { status: 'error', error: String(err) };
    }
  });

  // Assign proxy to account
  safeHandle(
    IPC_CHANNELS.ACCOUNTS.ASSIGN_PROXY,
    async (_event, accountId: string, proxyString: string | null) => {
      try {
        imapManager.assignProxy(accountId, proxyString);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );

  // Mass assign proxy
  safeHandle(
    IPC_CHANNELS.ACCOUNTS.MASS_ASSIGN_PROXY,
    async (_event, accountIds: string[], proxyString: string | null) => {
      try {
        imapManager.massAssignProxy(accountIds, proxyString);
        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  );
}
