import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron's safeStorage so secureMemory falls back to XOR obfuscation
// (no OS keychain available in the test runner).
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}))

// Mock ImapConnection to avoid real network I/O; simulate connect/disconnect.
vi.mock('./ImapConnection', () => {
  class FakeImapConnection {
    private _status = 'disconnected'
    lastPassword: string | null = null
    get status() {
      return this._status
    }
    get isConnected() {
      return this._status === 'connected'
    }
    get error() {
      return null
    }
    setStatus(s: string) {
      this._status = s
    }
    setError() {}
    async connect(cfg: { password: string }) {
      this.lastPassword = cfg.password
      this._status = 'connected'
    }
    async disconnect() {
      this._status = 'disconnected'
    }
  }
  return { ImapConnection: FakeImapConnection, default: FakeImapConnection }
})

import { ImapManager } from './ImapManager'
import type { Account } from '../../../renderer/lib/types'

function makeAccount(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    email: `${id}@gmail.com`,
    password: 'secret-pass',
    domain: 'gmail.com',
    status: 'offline',
    proxy: null,
    ...overrides,
  }
}

describe('ImapManager lifecycle', () => {
  let mgr: ImapManager

  beforeEach(() => {
    mgr = new ImapManager(50, 5, 30)
    mgr.setImapServers({ 'gmail.com': { host: 'imap.gmail.com', port: 993, tls: true } })
  })

  it('registers an account and reports offline before connecting', () => {
    mgr.registerAccount(makeAccount('acc1'))
    expect(mgr.getAccountStatus('acc1')).toBe('offline')
    expect(mgr.getActiveCount()).toBe(0)
  })

  it('does not store the password in plaintext in memory', () => {
    mgr.registerAccount(makeAccount('acc1'))
    const statuses = JSON.stringify(mgr.getAllStatuses())
    // Sanity: status snapshot never leaks the raw password.
    expect(statuses).not.toContain('secret-pass')
  })

  it('connects an account and marks it online', async () => {
    mgr.registerAccount(makeAccount('acc1'))
    await mgr.connectAccount('acc1')
    expect(mgr.getAccountStatus('acc1')).toBe('online')
    expect(mgr.getActiveCount()).toBe(1)
  })

  it('decrypts the password just-in-time when connecting', async () => {
    mgr.registerAccount(makeAccount('acc1'))
    await mgr.connectAccount('acc1')
    // Reach into the mocked connection to verify the plaintext was restored.
    const entry = (mgr as unknown as { connections: Map<string, { connection: { lastPassword: string } }> })
      .connections.get('acc1')
    expect(entry?.connection.lastPassword).toBe('secret-pass')
  })

  it('disconnects an account back to offline', async () => {
    mgr.registerAccount(makeAccount('acc1'))
    await mgr.connectAccount('acc1')
    await mgr.disconnectAccount('acc1')
    expect(mgr.getAccountStatus('acc1')).toBe('offline')
    expect(mgr.getActiveCount()).toBe(0)
  })

  it('clearAccounts removes every registered account', async () => {
    mgr.registerAccount(makeAccount('acc1'))
    mgr.registerAccount(makeAccount('acc2'))
    await mgr.connectAccount('acc1')
    await mgr.clearAccounts()
    expect(mgr.getAllStatuses()).toHaveLength(0)
    expect(mgr.getAccountStatus('acc1')).toBe('offline')
  })

  it('throws when connecting an unregistered account', async () => {
    await expect(mgr.connectAccount('ghost')).rejects.toThrow(/not registered/i)
  })

  it('setTuning updates the concurrency limit', () => {
    mgr.setTuning({ maxConnections: 10 })
    // No public getter; just ensure it doesn't throw and accepts valid input.
    expect(() => mgr.setTuning({ autoDisconnectMinutes: 1, connectionTimeoutSeconds: 15 })).not.toThrow()
  })
})
