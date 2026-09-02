import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the imapflow client: no network I/O, connect() is user-controlled.
const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('imapflow', () => {
  class FakeImapFlow {
    private handlers: Record<string, Array<(e?: unknown) => void>> = {}
    on(event: string, fn: (e?: unknown) => void): void {
      ;(this.handlers[event] ??= []).push(fn)
    }
    connect = (...args: unknown[]) => mocks.connect(...args)
    logout = (...args: unknown[]) => mocks.logout(...args)
    noop = async () => {}
  }
  return { ImapFlow: FakeImapFlow }
})

import { ImapConnection } from './ImapConnection'

const baseConfig = {
  email: 'user@example.com',
  password: 'secret',
  imapServer: { host: 'imap.example.com', port: 993, tls: true },
}

describe('ImapConnection.connect concurrency', () => {
  beforeEach(() => {
    mocks.connect.mockReset()
    mocks.logout.mockReset()
    mocks.logout.mockResolvedValue(undefined)
  })

  it('joins an in-flight connect instead of throwing "already in progress"', async () => {
    let resolveConnect!: () => void
    mocks.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve
        }),
    )
    const conn = new ImapConnection()
    const p1 = conn.connect(baseConfig)
    const p2 = conn.connect(baseConfig)
    await new Promise((r) => setTimeout(r, 5))
    resolveConnect()
    await Promise.all([p1, p2])
    // One shared handshake — the second call joined the first.
    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(conn.status).toBe('connected')
  })

  it('resolves immediately when already connected', async () => {
    mocks.connect.mockResolvedValue(undefined)
    const conn = new ImapConnection()
    await conn.connect(baseConfig)
    await conn.connect(baseConfig)
    expect(mocks.connect).toHaveBeenCalledTimes(1)
  })

  it('cancels the handshake when disconnect() arrives mid-connect', async () => {
    let resolveConnect!: () => void
    mocks.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve
        }),
    )
    const conn = new ImapConnection()
    const pending = conn.connect(baseConfig)
    await new Promise((r) => setTimeout(r, 5))
    const teardown = conn.disconnect()
    resolveConnect()
    // The abandoned handshake must not report success.
    await expect(pending).rejects.toThrow(/cancel/i)
    await teardown
    // The fresh client is logged out instead of leaking.
    expect(mocks.logout).toHaveBeenCalled()
    expect(conn.status).toBe('disconnected')
  })
})
