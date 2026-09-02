import { EventEmitter } from 'node:events'
import type { Account, ParsedProxy, ImapServerConfig, MailFolder } from '../../../renderer/lib/types'
import { ImapConnection } from './ImapConnection'
import { ConfigParser } from '../config/ConfigParser'
import { protectSecret, revealSecret } from '../store/secureMemory'

/** Promise-based delay */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

interface ConnectionEntry {
  account: Account
  connection: ImapConnection
  lastUsed: Date
  /** Last opened folder path — needed for fetchMessageContent/markAsRead */
  lastFolder: string | null
}

/**
 * ImapManager orchestrates all IMAP connections.
 * Manages connection pool with lazy connecting, auto-disconnect,
 * and concurrency limits.
 */
export class ImapManager extends EventEmitter {
  private connections: Map<string, ConnectionEntry> = new Map()
  private maxConcurrentConnections: number
  private autoDisconnectMs: number
  private connectionTimeoutMs: number
  private imapServers: Record<string, ImapServerConfig> = {}
  private proxyPool: ParsedProxy[] = []
  private autoDisconnectTimers: Map<string, NodeJS.Timeout> = new Map()

  constructor(
    maxConcurrentConnections: number = 50,
    autoDisconnectMinutes: number = 5,
    connectionTimeoutSeconds: number = 30,
  ) {
    super()
    this.maxConcurrentConnections = maxConcurrentConnections
    this.autoDisconnectMs = autoDisconnectMinutes * 60 * 1000
    this.connectionTimeoutMs = connectionTimeoutSeconds * 1000
  }

  /**
   * Update runtime tuning parameters from user settings.
   * `undefined` fields keep their current value. Applied to new connections;
   * already-open connections keep their current auto-disconnect schedule.
   */
  setTuning(opts: {
    maxConnections?: number
    autoDisconnectMinutes?: number
    connectionTimeoutSeconds?: number
  }): void {
    if (typeof opts.maxConnections === 'number' && opts.maxConnections > 0) {
      this.maxConcurrentConnections = opts.maxConnections
    }
    if (typeof opts.autoDisconnectMinutes === 'number' && opts.autoDisconnectMinutes >= 0) {
      this.autoDisconnectMs = opts.autoDisconnectMinutes * 60 * 1000
    }
    if (typeof opts.connectionTimeoutSeconds === 'number' && opts.connectionTimeoutSeconds > 0) {
      this.connectionTimeoutMs = opts.connectionTimeoutSeconds * 1000
    }
  }

  /**
   * Set IMAP servers configuration
   */
  setImapServers(servers: Record<string, ImapServerConfig>): void {
    this.imapServers = servers
  }

  /**
   * Set proxy pool
   */
  setProxyPool(proxies: ParsedProxy[]): void {
    this.proxyPool = proxies
  }

  /**
   * Register an account in the manager
   */
  registerAccount(account: Account): void {
    if (!this.connections.has(account.id)) {
      // Encrypt the password at rest in memory — it's only decrypted briefly
      // inside connectAccount(). Prevents plaintext credentials lingering in
      // long-lived objects / heap dumps.
      const secured: Account = {
        ...account,
        password: account.password ? protectSecret(account.password) : account.password,
      }
      this.connections.set(account.id, {
        account: secured,
        connection: new ImapConnection(),
        lastUsed: new Date(),
        lastFolder: null,
      })
      // Lazy connect — connection only on first use
    }
  }

  /**
   * Remove an account
   */
  async removeAccount(accountId: string): Promise<void> {
    const entry = this.connections.get(accountId)
    if (entry) {
      await entry.connection.disconnect()
      this.connections.delete(accountId)
      this.clearAutoDisconnectTimer(accountId)
    }
  }

  /**
   * Remove all registered accounts (disconnect + clear map).
   * Called on re-import so stale accounts don't linger.
   */
  async clearAccounts(): Promise<void> {
    const ids = Array.from(this.connections.keys())
    await Promise.allSettled(
      ids.map((id) => this.removeAccount(id)),
    )
    this.connections.clear()
    for (const [, timer] of this.autoDisconnectTimers) {
      clearTimeout(timer)
    }
    this.autoDisconnectTimers.clear()
  }

  /**
   * Connect a single account.
   * Parses proxy from account settings, resolves IMAP server.
   */
  async connectAccount(accountId: string): Promise<void> {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    const { account, connection } = entry

    if (connection.isConnected) return

    // Check connection limit
    const activeCount = this.getActiveCount()
    if (activeCount >= this.maxConcurrentConnections) {
      // Disconnect least recently used
      this.disconnectLeastRecentlyUsed()
    }

    // Resolve IMAP server
    const imapServer = ConfigParser.resolveImapServer(account.domain, this.imapServers)

    // Resolve proxy
    let proxy: ParsedProxy | undefined
    if (account.proxy) {
      proxy = this.proxyPool.find((p) => p.raw === account.proxy)
      if (!proxy) {
        // Parse proxy string directly
        try {
          proxy = ConfigParser.parseProxyString(account.proxy)
        } catch {
          throw new Error(`Cannot parse proxy: ${account.proxy}`)
        }
      }
    }

    try {
      await connection.connect({
        email: account.email,
        // Decrypt just-in-time; the plaintext lives only in this call frame.
        password: account.password ? revealSecret(account.password) : '',
        imapServer,
        proxy,
        timeoutMs: this.connectionTimeoutMs,
      })

      entry.lastUsed = new Date()
      this.emit('account:connected', accountId)
    } catch (err) {
      this.emit('account:error', accountId, err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  /**
   * Disconnect a single account
   */
  async disconnectAccount(accountId: string): Promise<void> {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    await entry.connection.disconnect()
    entry.lastFolder = null
    this.clearAutoDisconnectTimer(accountId)
    this.emit('account:disconnected', accountId)
  }

  /**
   * Connect all registered accounts sequentially by domain groups.
   *
   * Strategy:
   *   1. Group accounts by domain
   *   2. For each domain: connect the first account — if it succeeds,
   *      connect the rest of the group with staggered delay
   *   3. If the first account fails (bad IMAP server / unreachable),
   *      skip the rest of the domain — they'll fail too
   *
   * This prevents hammering IMAP servers with 1000 simultaneous connections
   * and avoids pointless retries when the server itself is down.
   */
  async connectAll(): Promise<void> {
    // Group account IDs by domain
    const byDomain: Map<string, string[]> = new Map()
    for (const [id, entry] of this.connections) {
      const d = entry.account.domain
      if (!byDomain.has(d)) byDomain.set(d, [])
      byDomain.get(d)!.push(id)
    }

    const domains = Array.from(byDomain.keys())

    /** Connect every account of one domain (probe first, then staggered). */
    const connectDomain = async (domain: string): Promise<void> => {
      const accountIds = byDomain.get(domain)!
      if (accountIds.length === 0) return

      // Connect the first account — it's the "probe" for this domain
      const firstId = accountIds[0]
      try {
        await this.connectAccount(firstId)
      } catch {
        // Probe failed — skip remaining accounts in this domain
        // (they share the same IMAP server, so they'll fail too)
        for (const id of accountIds.slice(1)) {
          const entry = this.connections.get(id)
          if (entry) {
            entry.connection.setStatus('error')
            entry.connection.setError(`Skipped: domain probe (${domain}) failed`)
          }
          this.emit('account:error', id, `Domain probe (${domain}) failed — account skipped`)
        }
        return
      }

      // Probe succeeded — connect the rest with staggered delay
      for (const id of accountIds.slice(1)) {
        // Respect concurrency limit
        if (this.getActiveCount() >= this.maxConcurrentConnections) {
          this.disconnectLeastRecentlyUsed()
        }

        try {
          await this.connectAccount(id)
        } catch (err) {
          // Individual auth failure — don't skip others (server is alive)
          console.error(`[connectAll] ${id}: ${err instanceof Error ? err.message : err}`)
        }

        // Stagger between accounts in same domain (avoid rate-limit)
        await sleep(200)
      }
    }

    // Process domain groups in parallel batches. Different domains hit
    // different IMAP servers, so parallelism is safe and cuts total time
    // roughly by the batch size (e.g. 50 domains: 4x faster than serial).
    const DOMAIN_BATCH_SIZE = 4
    for (let i = 0; i < domains.length; i += DOMAIN_BATCH_SIZE) {
      const batch = domains.slice(i, i + DOMAIN_BATCH_SIZE)
      await Promise.allSettled(batch.map((d) => connectDomain(d)))
    }
  }

  /**
   * Disconnect all accounts
   */
  async disconnectAll(): Promise<void> {
    const promises: Promise<void>[] = []

    for (const [id, entry] of this.connections) {
      if (entry.connection.isConnected) {
        promises.push(
          this.disconnectAccount(id).catch((err) => {
            console.error(`Failed to disconnect ${entry.account.email}: ${err.message}`)
          }),
        )
      }
    }

    await Promise.allSettled(promises)
  }

  /**
   * Reconnect all accounts
   */
  async reconnectAll(): Promise<void> {
    await this.disconnectAll()
    // Short delay
    await new Promise((r) => setTimeout(r, 1000))
    await this.connectAll()
  }

  /**
   * Connect only accounts with specific proxy.
   */
  async connectByProxy(proxyString: string): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [id, entry] of this.connections) {
      if (entry.account.proxy === proxyString && !entry.connection.isConnected) {
        promises.push(this.connectAccount(id))
      }
    }
    await Promise.allSettled(promises)
  }

  /**
   * Fetch folders for an account
   */
  async fetchFolders(accountId: string): Promise<MailFolder[]> {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    // Ensure connected
    if (!entry.connection.isConnected) {
      await this.connectAccount(accountId)
    }

    entry.lastUsed = new Date()

    const rawFolders = await entry.connection.listFolders()

    // Build tree structure
    const buildTree = (items: typeof rawFolders): MailFolder[] => {
      const map: Record<string, MailFolder> = {}
      const roots: MailFolder[] = []

      for (const item of items) {
        map[item.path] = {
          name: item.name,
          fullPath: item.path,
          delimiter: item.delimiter,
          children: [],
        }
      }

      for (const [path, folder] of Object.entries(map)) {
        const delimiter = folder.delimiter || '/'
        const parts = path.split(delimiter)
        if (parts.length <= 1) {
          roots.push(folder)
        } else {
          const parentPath = parts.slice(0, -1).join(delimiter)
          const parent = map[parentPath]
          if (parent) {
            parent.children.push(folder)
          } else {
            roots.push(folder) // Orphan — push to root
          }
        }
      }

      return roots
    }

    return buildTree(rawFolders)
  }

  /**
   * Fetch messages for an account folder
   */
  async fetchMessages(
    accountId: string,
    folder: string,
    options?: { page?: number; pageSize?: number; sortOrder?: 'asc' | 'desc'; searchQuery?: string },
  ): Promise<{
    messages: Array<any>
    total: number
  }> {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    if (!entry.connection.isConnected) {
      await this.connectAccount(accountId)
    }

    entry.lastUsed = new Date()
    entry.lastFolder = folder
    this.scheduleAutoDisconnect(accountId)

    return entry.connection.fetchMessages(folder, options)
  }

  /**
   * Fetch message content.
   * Passes the last opened folder so ImapConnection can ensure the
   * correct mailbox is selected before issuing the UID fetch.
   */
  async fetchMessageContent(accountId: string, uid: string) {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    if (!entry.connection.isConnected) {
      await this.connectAccount(accountId)
    }

    entry.lastUsed = new Date()
    this.scheduleAutoDisconnect(accountId)

    return entry.connection.fetchMessageContent(uid, entry.lastFolder ?? undefined)
  }

  /**
   * Fetch raw binary data for a single attachment (for saving to disk).
   * Returns filename, mimeType and the decoded Buffer.
   */
  async getAttachmentData(
    accountId: string,
    uid: string,
    attachmentId: string,
  ): Promise<{ filename: string; mimeType: string; data: Buffer }> {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    if (!entry.connection.isConnected) {
      await this.connectAccount(accountId)
    }

    entry.lastUsed = new Date()
    this.scheduleAutoDisconnect(accountId)

    return entry.connection.getAttachmentData(uid, attachmentId, entry.lastFolder ?? undefined)
  }

  /**
   * Fetch the raw RFC822 source of a message (for .eml export).
   */
  async getRawMessage(accountId: string, uid: string): Promise<Buffer> {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    if (!entry.connection.isConnected) {
      await this.connectAccount(accountId)
    }

    entry.lastUsed = new Date()
    this.scheduleAutoDisconnect(accountId)

    return entry.connection.getRawMessage(uid, entry.lastFolder ?? undefined)
  }

  /**
   * Search messages
   */
  async searchMessages(accountId: string, query: string) {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    if (!entry.connection.isConnected) {
      await this.connectAccount(accountId)
    }

    return entry.connection.searchMessages(query)
  }

  /**
   * Mark message as read
   */
  async markAsRead(accountId: string, uid: string): Promise<void> {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    if (!entry.connection.isConnected) return
    await entry.connection.markAsRead(uid)
  }

  /**
   * Get status for a single account
   */
  getAccountStatus(accountId: string): 'online' | 'offline' | 'connecting' | 'error' {
    const entry = this.connections.get(accountId)
    if (!entry) return 'offline'

    const connStatus = entry.connection.status
    switch (connStatus) {
      case 'connected': return 'online'
      case 'connecting': return 'connecting'
      case 'error': return 'error'
      default: return 'offline'
    }
  }

  /**
   * Get all account statuses
   */
  getAllStatuses(): Array<{ accountId: string; status: string; error: string | null }> {
    const result: Array<{ accountId: string; status: string; error: string | null }> = []
    for (const [id, entry] of this.connections) {
      result.push({
        accountId: id,
        status: this.getAccountStatus(id),
        error: entry.connection.error,
      })
    }
    return result
  }

  /**
   * Assign a proxy to an account
   */
  assignProxy(accountId: string, proxyString: string | null): void {
    const entry = this.connections.get(accountId)
    if (!entry) throw new Error(`Account ${accountId} not registered`)

    entry.account.proxy = proxyString
  }

  /**
   * Mass assign proxy to multiple accounts
   */
  massAssignProxy(accountIds: string[], proxyString: string | null): void {
    for (const id of accountIds) {
      this.assignProxy(id, proxyString)
    }
  }

  /**
   * Get total active connections count
   */
  getActiveCount(): number {
    let count = 0
    for (const [, entry] of this.connections) {
      if (entry.connection.isConnected) count++
    }
    return count
  }

  /**
   * Cleanup all connections
   */
  async destroy(): Promise<void> {
    for (const [, entry] of this.connections) {
      await entry.connection.disconnect()
    }
    for (const [, timer] of this.autoDisconnectTimers) {
      clearTimeout(timer)
    }
    this.connections.clear()
    this.autoDisconnectTimers.clear()
  }

  // -- Private --

  private disconnectLeastRecentlyUsed(): void {
    let lruId: string | null = null
    let lruDate: Date | null = null

    for (const [id, entry] of this.connections) {
      if (entry.connection.isConnected) {
        if (!lruDate || entry.lastUsed < lruDate) {
          lruId = id
          lruDate = entry.lastUsed
        }
      }
    }

    if (lruId) {
      this.disconnectAccount(lruId).catch(() => {})
    }
  }

  private scheduleAutoDisconnect(accountId: string): void {
    this.clearAutoDisconnectTimer(accountId)

    const timer = setTimeout(() => {
      const entry = this.connections.get(accountId)
      if (entry && entry.connection.isConnected) {
        this.disconnectAccount(accountId).catch(() => {})
      }
    }, this.autoDisconnectMs)

    this.autoDisconnectTimers.set(accountId, timer)
  }

  private clearAutoDisconnectTimer(accountId: string): void {
    const timer = this.autoDisconnectTimers.get(accountId)
    if (timer) {
      clearTimeout(timer)
      this.autoDisconnectTimers.delete(accountId)
    }
  }
}

export default ImapManager