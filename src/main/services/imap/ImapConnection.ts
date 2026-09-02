import { ImapFlow } from 'imapflow'
import type { ImapServerConfig, ParsedProxy } from '../../../renderer/lib/types'

interface ImapConnectionConfig {
  email: string
  password: string
  imapServer: ImapServerConfig
  proxy?: ParsedProxy
  logger?: boolean | object
  /** Per-connection timeout override (ms). Falls back to CONNECTION_TIMEOUT_MS. */
  timeoutMs?: number
}

/**
 * Build a proxy URL string for imapflow from a parsed proxy config.
 * imapflow's documented "proxy" option accepts a URL string:
 *   socks5://[user:pass@]host:port  |  http(s)://[user:pass@]host:port
 * Credentials are percent-encoded to survive special characters.
 */
export function buildProxyUrl(proxy: ParsedProxy): string {
  const auth =
    proxy.user !== undefined && proxy.user.length > 0
      ? `${encodeURIComponent(proxy.user)}:${encodeURIComponent(proxy.pass ?? '')}@`
      : '';
  return `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;
}

/**
 * Recursively inspect an IMAP BODYSTRUCTURE to detect real attachments.
 * A node counts as an attachment when its disposition is "attachment" or
 * when it carries a filename and is not a text/ part.
 */
export function hasAttachmentInStructure(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const nodes: unknown[] = Array.isArray(node) ? node : [node]
  for (const item of nodes) {
    if (!item || typeof item !== 'object') continue
    const p = item as {
      disposition?: { type?: string; params?: Record<string, string> } | null
      parameters?: Record<string, string> | null
      type?: string
      childNodes?: unknown[]
    }
    if (p.disposition?.type?.toLowerCase() === 'attachment') return true
    const filename = p.parameters?.name ?? p.disposition?.params?.filename
    if (filename && !(p.type ?? '').toLowerCase().startsWith('text/')) return true
    if (p.childNodes && hasAttachmentInStructure(p.childNodes)) return true
  }
  return false
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface MailboxInfo {
  name: string
  path: string
  delimiter: string
}

export interface MessageInfo {
  uid: string
  subject: string
  fromName: string
  fromEmail: string
  date: Date
  isRead: boolean
  isFlagged: boolean
  hasAttachments: boolean
  size: number
}

export interface MessageContent {
  uid: string
  subject: string
  fromName: string
  fromEmail: string
  to: string
  cc?: string
  bcc?: string
  replyTo?: string
  date: Date
  htmlBody: string
  textBody: string
  headers: Record<string, string>
  attachments: AttachmentInfo[]
}

export interface AttachmentInfo {
  id: string
  filename: string
  size: number
  mimeType: string
  contentDisposition: string
  /** Content-ID for inline (cid:) images, without angle brackets */
  contentId?: string
  /** True when disposition is "inline" (embedded image), not a downloadable file */
  isInline?: boolean
}

/**
 * Internal attachment representation that also carries the decoded binary data.
 * The `data` buffer is NEVER sent over IPC to the renderer (would waste memory
 * and IPC bandwidth). It's used server-side for disk save / cid: inlining.
 */
export interface AttachmentData extends AttachmentInfo {
  data: Buffer
}

/**
 * ImapConnection manages a single IMAP connection lifecycle.
 * Wraps imapflow's ImapFlow with proxy support and connection pooling.
 */
export class ImapConnection {
  private client: ImapFlow | null = null
  private config: ImapConnectionConfig | null = null
  private _status: ConnectionStatus = 'disconnected'
  private lastError: string | null = null
  private connectionTimeoutId: NodeJS.Timeout | null = null
  /** Periodic NOOP keep-alive timer (prevents server/NAT idle drops). */
  private heartbeatId: NodeJS.Timeout | null = null
  /** True during intentional disconnect() - suppresses close-handler side effects. */
  private closing = false
  /** How often to send NOOP while connected. */
  private static readonly HEARTBEAT_INTERVAL_MS = 60_000
  private readonly CONNECTION_TIMEOUT_MS = 30_000
  private reconnectAttempts = 0
  private readonly MAX_RECONNECT_ATTEMPTS = 3
  /** Tracks the currently opened mailbox path (or null if none selected) */
  private currentMailbox: string | null = null
  /** In-flight connect attempt; concurrent callers await the same promise. */
  private connectPromise: Promise<void> | null = null
  /** Rejector of the current handshake's timeout promise, used by disconnect() to abort it. */
  private connectCancel: ((err: Error) => void) | null = null

  get status(): ConnectionStatus {
    return this._status;
  }

  get error(): string | null {
    return this.lastError;
  }

  get isConnected(): boolean {
    return this._status === 'connected' && this.client !== null;
  }

  /** Returns the currently opened mailbox path, or null */
  get mailbox(): string | null {
    return this.currentMailbox;
  }

  /** Externally set status (used by ImapManager to mark skipped accounts) */
  setStatus(s: ConnectionStatus): void {
    this._status = s;
  }

  /** Externally set error message */
  setError(msg: string): void {
    this.lastError = msg;
  }

  /**
   * Connect to IMAP server with optional proxy.
   * Concurrent calls join the in-flight attempt instead of failing —
   * selecting an account triggers fetchFolders + fetchMessages (and possibly
   * a manual connect) at once, and each calls connectAccount() for the same
   * connection.
   */
  async connect(config: ImapConnectionConfig): Promise<void> {
    if (this._status === 'connected' && this.client) return
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = this.attemptConnect(config)
    try {
      await this.connectPromise
    } finally {
      this.connectPromise = null
      this.connectCancel = null
    }
  }

  /**
   * Single connect attempt with internal retries. The first caller's config
   * wins — late joiners get the connection established with it.
   */
  private async attemptConnect(config: ImapConnectionConfig): Promise<void> {
    this.config = config;
    this.closing = false
    this._status = 'connecting';
    this.lastError = null;

    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= this.MAX_RECONNECT_ATTEMPTS; attempt++) {
      let client: ImapFlow | null = null;
      try {
        const clientConfig: Record<string, unknown> = {
          host: config.imapServer.host,
          port: config.imapServer.port,
          secure: config.imapServer.tls,
          auth: {
            user: config.email,
            pass: config.password,
          },
          logger: false,
          tls: {
            rejectUnauthorized: config.imapServer.tlsOptions?.rejectUnauthorized ?? false,
          },
        }

        if (config.proxy) {
            // imapflow expects proxy as a URL string, e.g. "socks5://user:pass@host:1080".
            // An object form is NOT part of the documented API and is silently ignored,
            // which would leak a direct (unproxied) connection.
            clientConfig.proxy = buildProxyUrl(config.proxy);
        }

        const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : this.CONNECTION_TIMEOUT_MS;
        client = new ImapFlow(clientConfig as any);

        // CRITICAL: ImapFlow emits 'error' on socket failures (e.g. idle socket
        // timeout). An EventEmitter with no error listener throws
        // uncaughtException and kills the Electron main process. Always guard.
        client.on('error', (err: Error) => {
          this.lastError = err.message
          if (!this.closing && this.client === client) {
            this._status = 'error'
            this.currentMailbox = null
          }
          console.warn(`[imap] ${config.email} client error: ${err.message}`)
        })
        client.on('close', () => {
          if (!this.closing && this.client === client) {
            this._status = this._status === 'connected' ? 'disconnected' : this._status
            this.currentMailbox = null
            this.stopHeartbeat()
          }
        })
        const timeoutPromise = new Promise<never>((_, reject) => {
          this.connectCancel = reject
          this.connectionTimeoutId = setTimeout(() => {
            reject(new Error(`Connection timeout after ${timeoutMs}ms`))
          }, timeoutMs)
        })

        try {
          await Promise.race([client.connect(), timeoutPromise]);
        } finally {
          if (this.connectionTimeoutId) {
            clearTimeout(this.connectionTimeoutId);
            this.connectionTimeoutId = null;
          }
        }

        this.client = client;
        if (this.closing) {
          // disconnect() ran while the handshake was in flight — log the fresh
          // client out instead of reporting a connection nobody owns anymore.
          await client.logout().catch(() => {});
          this.client = null;
          throw new Error('Connection cancelled');
        }
        this._status = 'connected';
        this.reconnectAttempts = 0;
        this.lastError = null;
        this.startHeartbeat()
        return // success
      } catch (err) {
        lastErr = err;
        this.lastError = err instanceof Error ? err.message : String(err);

        // A disconnect() during the handshake or the retry backoff cancels the
        // whole attempt — don't retry a connection nobody owns anymore.
        if (this.closing) {
          this.stopHeartbeat()
          if (client) {
            await client.logout().catch(() => {});
            client = null;
          }
          this._status = 'disconnected';
          throw err;
        }

        // Force-close the half-open client from THIS attempt before retrying.
        // On timeout/failure `this.client` is still null (only set on success),
        // so we must close the local `client` or its socket leaks.
        if (client) {
          await client.logout().catch(() => {});
          client = null;
        }

        if (attempt < this.MAX_RECONNECT_ATTEMPTS) {
          // Backoff before retry: 1s, 2s, 4s
          const delay = 1000 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          this._status = 'connecting';
        }
      }
    }

    // All attempts exhausted
    this.stopHeartbeat()
    this._status = 'error';
    this.reconnectAttempts = 0;
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * Disconnect and cleanup.
   */
  /**
   * Start NOOP keep-alive loop for the active client.
   * Keeps NAT mappings and server sessions alive; converts silent socket
   * deaths into handled error events instead of late raw timeouts.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatId = setInterval(() => {
      const c = this.client
      if (!c || this.closing) return
      // noop() rejects on dead sockets -> handled by the error listener
      void c.noop().catch(() => {})
    }, ImapConnection.HEARTBEAT_INTERVAL_MS)
    // Do not keep the process alive purely for heartbeats
    this.heartbeatId.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.heartbeatId) {
      clearInterval(this.heartbeatId)
      this.heartbeatId = null
    }
  }

  async disconnect(): Promise<void> {
    this.closing = true
    this.stopHeartbeat()
    if (this.connectionTimeoutId) {
      clearTimeout(this.connectionTimeoutId);
      this.connectionTimeoutId = null;
    }
    // Abort an in-flight handshake (if any) so awaiting callers don't hang.
    // attemptConnect still runs to completion internally; its success path
    // checks `closing` and logs the fresh client out before we set nulls.
    this.connectCancel?.(new Error('Connection cancelled'));
    this.connectCancel = null;

    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        // Ignore logout errors - force close
      }
      this.client = null;
    }

    this._status = 'disconnected';
    this.reconnectAttempts = 0;
    this.currentMailbox = null;
  }

  /**
   * Fetch list of mailboxes/folders.
   */
  async listFolders(): Promise<MailboxInfo[]> {
    if (!this.client) throw new Error('Not connected')

    const mailboxes = await this.client.list();
    return mailboxes.map((mbox) => ({
      name: mbox.name,
      path: mbox.path,
      delimiter: mbox.delimiter,
    }))
  }

  /**
   * Fetch messages from a folder with pagination.
   */
  async fetchMessages(
    folder: string,
    options: {
      page?: number
      pageSize?: number
      sortOrder?: 'asc' | 'desc'
      searchQuery?: string
    } = {},
  ): Promise<{ messages: MessageInfo[]; total: number }> {
    if (!this.client) throw new Error('Not connected')

    const { page = 1, pageSize = 50, sortOrder = 'desc', searchQuery } = options;

    await this.client.mailboxOpen(folder);
    this.currentMailbox = folder;

    const total = (this.client.mailbox as any).exists;

    // Empty mailbox — nothing to fetch (avoids an invalid "1:0" sequence range).
    if (!total || total < 1) {
      return { messages: [], total: 0 }
    }

    let searchCriteria: Record<string, unknown> = {}
    if (searchQuery) {
      searchCriteria = { or: [
        { subject: searchQuery },
        { body: searchQuery },
        { from: searchQuery },
      ] }
    }

    const start =
      sortOrder === 'desc'
        ? Math.max(total - page * pageSize + 1, 1)
        : Math.max(1, (page - 1) * pageSize + 1);
    const end =
      sortOrder === 'desc'
        ? total - (page - 1) * pageSize
        : Math.min(total, page * pageSize);

    // Page is past the end of the mailbox — the computed range would be invalid
    // (e.g. "1:-40" or "51:10"). Return an empty page rather than issuing a
    // malformed IMAP fetch that would throw.
    if (start > end || end < 1) {
      return { messages: [], total }
    }

    const range = `${start}:${end}`;

    const messages: MessageInfo[] = [];
    const stream = this.client.fetch(
      { ...searchCriteria, seq: range } as any,
      {
        uid: true,
        internalDate: true,
        envelope: true,
        flags: true,
        size: true,
        bodyStructure: true,
      } as any,
    )

    for await (const msg of stream as any) {
      // imapflow returns flags as a Set<string>, not an Array —
      // use .has() instead of .includes().
      const flags: Set<string> = msg.flags ?? new Set();
      messages.push({
        uid: String(msg.uid),
        subject: msg.envelope?.subject || '(Без темы)',
        fromName: msg.envelope?.from?.[0]?.name || msg.envelope?.from?.[0]?.address || 'Неизвестный',
        fromEmail: msg.envelope?.from?.[0]?.address || '',
        date: msg.envelope?.date || new Date(),
        isRead: flags.has('\\Seen'),
        isFlagged: flags.has('\\Flagged'),
        hasAttachments: hasAttachmentInStructure(msg.bodyStructure),
        size: msg.size || 0,
      })
    }

    return { messages, total }
  }

  /**
   * Fetch full content of a single message by UID.
   * Requires a mailbox to be open — the caller must pass the folder path
   * so we can ensure it's selected before issuing the fetch.
   * Uses fetchOne() with { source: true } to get the raw RFC822 message buffer.
   */
  async fetchMessageContent(uid: string, folder?: string): Promise<MessageContent> {
    if (!this.client) throw new Error('Not connected')

    // Ensure the correct mailbox is open — fetchOne operates on the
    // currently selected mailbox, and UIDs are only valid within one.
    if (folder && this.currentMailbox !== folder) {
      await this.client.mailboxOpen(folder);
      this.currentMailbox = folder;
    } else if (!this.currentMailbox) {
      throw new Error('No mailbox open — cannot fetch message content. Provide a folder argument.')
    }

    // fetchOne(seq, query, options):
    //   - seq: SequenceString (string | number | bigint) — NOT a SearchObject
    //   - options.uid: true  → interpret seq as a UID instead of a sequence number
    const msg = await this.client.fetchOne(
      parseInt(uid, 10),
      { source: true, envelope: true } as any,
      { uid: true } as any,
    )

    if (!msg) {
      throw new Error(`Message not found: uid=${uid}`)
    }

    // msg.source is a Buffer containing the raw RFC822 message.
    // KEEP as Buffer — converting to string prematurely destroys non-UTF-8 charset info.
    const rawBuffer: Buffer = msg.source ? (msg.source as Buffer) : Buffer.alloc(0);
    // Parse headers as latin1 (binary-safe) just for structure; charset is applied later.
    const rawLatin = rawBuffer.toString('latin1');
    const parsed = this.parseRawEmail(rawLatin, rawBuffer);

    // Embed inline (cid:) images as data: URIs directly into the HTML body so the
    // renderer can display them without a second round-trip. Done here in the main
    // process while the binary buffers are still available.
    const htmlWithInline = this.inlineCidImages(
      parsed.htmlBody || parsed.textBody || '',
      parsed.attachments,
    )

    return {
      uid: String(uid),
      subject: parsed.headers['Subject'] || msg.envelope?.subject || '',
      fromName: parsed.headers['From'] || '',
      fromEmail: this.extractEmail(parsed.headers['From'] || ''),
      to: parsed.headers['To'] || '',
      cc: parsed.headers['Cc'] || undefined,
      bcc: parsed.headers['Bcc'] || undefined,
      replyTo: parsed.headers['Reply-To'] || undefined,
      date: msg.envelope?.date || new Date(),
      htmlBody: htmlWithInline,
      textBody: parsed.textBody || '',
      headers: parsed.headers,
      // Strip the binary `data` buffer before sending over IPC — the renderer
      // only needs metadata. Binary bytes are fetched on demand via getAttachmentData().
      attachments: parsed.attachments.map(({ data: _data, ...meta }) => meta),
    }
  }

  /**
   * Fetch the raw binary bytes of a single attachment by id.
   * Re-parses the message source (attachments are not cached to keep memory low)
   * and returns the decoded Buffer plus metadata for saving to disk.
   */
  async getAttachmentData(
    uid: string,
    attachmentId: string,
    folder?: string,
  ): Promise<{ filename: string; mimeType: string; data: Buffer }> {
    if (!this.client) throw new Error('Not connected')

    if (folder && this.currentMailbox !== folder) {
      await this.client.mailboxOpen(folder);
      this.currentMailbox = folder;
    } else if (!this.currentMailbox) {
      throw new Error('No mailbox open — cannot fetch attachment. Provide a folder argument.')
    }

    const msg = await this.client.fetchOne(
      parseInt(uid, 10),
      { source: true } as any,
      { uid: true } as any,
    )
    if (!msg || !msg.source) {
      throw new Error(`Message not found: uid=${uid}`)
    }

    const rawBuffer = msg.source as Buffer;
    const parsed = this.parseRawEmail(rawBuffer.toString('latin1'), rawBuffer);
    const att = parsed.attachments.find((a) => a.id === attachmentId);
    if (!att) {
      throw new Error(`Attachment not found: id=${attachmentId}`)
    }

    return { filename: att.filename, mimeType: att.mimeType, data: att.data }
  }

  /**
   * Fetch the raw RFC822 source of a message (for .eml export).
   */
  async getRawMessage(uid: string, folder?: string): Promise<Buffer> {
    if (!this.client) throw new Error('Not connected')

    if (folder && this.currentMailbox !== folder) {
      await this.client.mailboxOpen(folder);
      this.currentMailbox = folder;
    } else if (!this.currentMailbox) {
      throw new Error('No mailbox open — cannot fetch message source. Provide a folder argument.')
    }

    const msg = await this.client.fetchOne(
      parseInt(uid, 10),
      { source: true } as any,
      { uid: true } as any,
    )
    if (!msg || !msg.source) {
      throw new Error(`Message not found: uid=${uid}`)
    }
    return msg.source as Buffer;
  }

  /**
   * Search messages in current folder.
   * Returns an array of UIDs matching the search query.
   */
  async searchMessages(query: string): Promise<string[]> {
    if (!this.client) throw new Error('Not connected')

    // imapflow search() accepts IMAP search criteria, not a freeform "q" string.
    // Use { body: query } to search message bodies.
    const results = await this.client.search({ body: query } as any, { uid: true } as any);
    if (!results) return []
    return (results as number[]).map(String);
  }

  /**
   * Mark a message as seen by UID.
   * The mailbox must already be open (caller ensures this).
   */
  async markAsRead(uid: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')
    if (!this.currentMailbox) throw new Error('No mailbox open — cannot mark as read')

    // messageFlagsAdd(range, flags, options):
    //   - range: SequenceString (string | number | bigint) — NOT { uid }
    //   - options.uid: true → interpret range as UID
    await this.client.messageFlagsAdd(
      parseInt(uid, 10),
      ['\\Seen'],
      { uid: true } as any,
    )
  }

  // -- Private helpers --

  /**
   * Parse a raw header block into a lowercase-keyed map, joining folded
   * continuation lines (RFC 5322: lines starting with SP/THT continue the
   * previous header). MIME part headers commonly fold Content-Type across
   * two lines — e.g. "Content-Type: multipart/alternative;\n boundary=..."
   * — and dropping the continuation loses the nested boundary, which made
   * the whole alternative structure unparseable and dumped raw MIME into
   * the rendered body.
   */
  private parseHeaderBlock(block: string): Record<string, string> {
    const headers: Record<string, string> = {}
    let currentKey = ''
    let currentValue = ''
    const flush = () => {
      if (currentKey) {
        headers[currentKey] = currentValue.trim()
      }
    }
    for (const line of block.split(/\r?\n/)) {
      if (/^[ \t]/.test(line) && currentKey) {
        currentValue += ' ' + line.trim()
      } else {
        flush()
        const idx = line.indexOf(':')
        if (idx > 0) {
          currentKey = line.substring(0, idx).trim().toLowerCase()
          currentValue = line.substring(idx + 1)
        } else {
          currentKey = ''
          currentValue = ''
        }
      }
    }
    flush()
    return headers
  }

  /**
   * Parse a raw RFC822 email source into headers, text/html bodies, and attachments.
   * `rawLatin` is the latin1 (binary-safe) view of the buffer for header parsing and
   * boundary splitting. `rawBuf` is the original Buffer, used for charset-aware body decoding.
   * Handles multipart/alternative and multipart/mixed. For complex nesting it falls
   * back to the first available text/html part.
   */
  private parseRawEmail(
    rawLatin: string,
    rawBuf: Buffer,
  ): {
    headers: Record<string, string>
    textBody: string
    htmlBody: string
    attachments: AttachmentData[]
  } {
    const headers: Record<string, string> = {}
    const attachments: AttachmentData[] = [];

    // Split headers from body at the first empty line
    // Work in latin1 so byte positions match the Buffer
    const headerEndIdx = rawLatin.search(/\r?\n\r?\n/);
    const headerBlock = headerEndIdx !== -1 ? rawLatin.substring(0, headerEndIdx) : rawLatin;
    // body offset in the Buffer (account for the CRLF CRLF separator)
    const bodyOffset = headerEndIdx !== -1 ? headerEndIdx + (rawLatin.substring(headerEndIdx).match(/^\r?\n\r?\n/)![0].length) : rawLatin.length;
    const bodyBuf = rawBuf.subarray(bodyOffset);
    const bodyLatin = bodyBuf.toString('latin1');

    // Parse headers — handle folded lines (continuation lines start with whitespace)
    const headerLines = headerBlock.split(/\r?\n/);
    let currentKey = '';
    let currentValue = '';
    for (const line of headerLines) {
      if (/^[ \t]/.test(line) && currentKey) {
        currentValue += ' ' + line.trim()
      } else {
        if (currentKey) {
          headers[currentKey] = currentValue.trim()
        }
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          currentKey = line.substring(0, colonIdx).trim();
          currentValue = line.substring(colonIdx + 1).trim();
        } else {
          currentKey = '';
          currentValue = '';
        }
      }
    }
    if (currentKey) {
      headers[currentKey] = currentValue.trim()
    }

    // Determine content type and boundary
    const contentType = headers['Content-Type'] || 'text/plain';
    const boundaryMatch = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
    const boundary = boundaryMatch ? boundaryMatch[1] : null;

    // Extract charset from top-level Content-Type (may be overridden per-part)
    const topCharset = this.extractCharset(contentType);

    // Recovery for relay-mangled mail: temp-mail providers strip or corrupt the
    // top-level Content-Type — from merely detaching the boundary parameter to
    // erasing the declaration entirely (only the delimiter lines survive).
    // Detection itself is well-guarded (≥3 occurrences + a closing delimiter),
    // so it is safe to always run it when no usable boundary was declared.
    let effectiveBoundary = boundary;
    if (!effectiveBoundary) {
      effectiveBoundary = this.detectBoundaryFromBody(bodyLatin);
    }

    let textBody = '';
    let htmlBody = '';

    const processBodyPart = (
      partLatin: string,
      partBuf: Buffer,
      partHeaders: Record<string, string>,
    ): void => {
      // RFC 2045: a part without Content-Type defaults to text/plain.
      // Minimalist senders (temp-mail providers) emit headerless parts —
      // treating them as '' dropped the body and rendered "(Пустое письмо)".
      const partContentType = partHeaders['content-type'] || 'text/plain';
      const partDisposition = partHeaders['content-disposition'] || '';
      const partEncoding = partHeaders['content-transfer-encoding'] || '';
      const partContentId = partHeaders['content-id'] || '';
      const partCharset = this.extractCharset(partContentType) || topCharset || 'utf-8';

      const dispositionLc = partDisposition.toLowerCase();
      const isAttachment = dispositionLc.includes('attachment');
      const isInline = dispositionLc.includes('inline') || partContentId !== '';
      // A part is a file (attachment or inline image) when it declares a filename,
      // has a Content-ID, or its disposition explicitly says so. Everything else
      // is treated as a body part (text/html or text/plain).
      const filename =
        this.extractFilename(partDisposition) || this.extractFilename(partContentType);
      const looksLikeFile =
        isAttachment || (isInline && (filename || partContentId)) || (filename && !partContentType.toLowerCase().startsWith('text/'));

      if (looksLikeFile) {
        // Extract the raw binary bytes (NOT charset-decoded — this is a file).
        const data = this.decodeTransferEncoding(partBuf, partEncoding);
        // Strip surrounding <> from Content-ID for cid: matching
        const cid = partContentId.replace(/^<|>$/g, '').trim() || undefined;
        attachments.push({
          id: String(attachments.length + 1),
          filename: filename
            ? this.decodeMimeHeader(filename)
            : `attachment_${attachments.length + 1}`,
          size: data.length,
          mimeType: partContentType.split(';')[0].trim() || 'application/octet-stream',
          contentDisposition: isAttachment ? 'attachment' : 'inline',
          contentId: cid,
          isInline: isInline && !isAttachment,
          data,
        })
        return
      }

      // Relay-mangled mail often strips part headers (no Content-Type, no
      // Content-Transfer-Encoding). Recover the transfer encoding from the
      // content itself, then infer the part's role after decoding — otherwise
      // the html part is dropped or both parts show as raw quoted-printable.
      const effectiveEncoding = partEncoding || this.sniffTransferEncoding(partBuf);
      const decodedString = this.decodeBodyToString(partBuf, effectiveEncoding, partCharset);
      const effectiveContentType =
        partHeaders['content-type'] || this.sniffContentType(decodedString);

      if (effectiveContentType.toLowerCase().includes('text/html') && !htmlBody) {
        htmlBody = decodedString;
      } else if (effectiveContentType.toLowerCase().includes('text/plain') && !textBody) {
        textBody = decodedString;
      } else if (effectiveContentType.toLowerCase().startsWith('text/') && !textBody) {
        // Other text/* subtypes (calendar, enriched, …) — surface as text
        // instead of silently dropping the part.
        textBody = decodedString;
      } else if (effectiveContentType.toLowerCase().includes('multipart/') && (!textBody || !htmlBody)) {
        // Nested multipart — extract boundary and recurse
        const nestedBoundaryMatch = partContentType.match(/boundary=["']?([^"';\s]+)["']?/i);
        if (nestedBoundaryMatch) {
          const nestedBoundary = nestedBoundaryMatch[1];
          const nestedParts = partLatin.split(new RegExp(`--${this.escapeRegex(nestedBoundary)}`, 'g'));
          for (const nestedPart of nestedParts) {
            if (!nestedPart || nestedPart.trim() === '' || nestedPart.trim() === '--') continue
            const nestedSplitIdx = nestedPart.search(/\r?\n\r?\n/);
            if (nestedSplitIdx === -1) continue
            const nestedHeadersBlock = nestedPart.substring(0, nestedSplitIdx);
            const nestedBodyOffset = nestedSplitIdx + (nestedPart.substring(nestedSplitIdx).match(/^\r?\n\r?\n/)![0].length);
            const nestedHeaders = this.parseHeaderBlock(nestedHeadersBlock)
            // Byte bounds of the nested part's BODY inside partBuf: skip the
            // nested part's own headers (+nestedBodyOffset — without it the
            // buffer started at the headers and they leaked into the body)
            // and stop before the CRLF that belongs to the next boundary.
            const nestedLatinBody = nestedPart.substring(nestedBodyOffset);
            const byteOffset = partLatin.indexOf(nestedPart);
            const nestedTrailingCrlf = nestedLatinBody.match(/\r?\n$/) ? nestedLatinBody.match(/\r?\n$/)![0].length : 0;
            const nestedBuf = byteOffset >= 0
              ? partBuf.subarray(byteOffset + nestedBodyOffset, byteOffset + nestedPart.length - nestedTrailingCrlf)
              : partBuf;
            processBodyPart(nestedLatinBody, nestedBuf, nestedHeaders)
          }
        }
      }
    }

    if (effectiveBoundary) {
      // Split body on boundary — work in latin1 for correct byte positions
      const parts = bodyLatin.split(new RegExp(`--${this.escapeRegex(effectiveBoundary)}`, 'g'));
      for (let pIdx = 0; pIdx < parts.length; pIdx++) {
        const part = parts[pIdx];
        if (!part || part.trim() === '' || part.trim() === '--') continue
        // Fragment 0 is everything before the first boundary delimiter —
        // the MIME preamble, never a part.
        if (pIdx === 0) continue

        // Normal parts have a headers block separated from the body by a blank
        // line. Relay-mangled headerless parts have NO separator at all (the
        // body starts right after the boundary newline) — the whole fragment
        // is then the body.
        const partSplitIdx = part.search(/\r?\n\r?\n/);
        let partHeadersBlock = '';
        let partBodyOffset = 0;
        if (partSplitIdx !== -1) {
          partHeadersBlock = part.substring(0, partSplitIdx);
          partBodyOffset = partSplitIdx + (part.substring(partSplitIdx).match(/^\r?\n\r?\n/)![0].length);
        } else {
          // Skip the newline that terminated the boundary line itself
          const lead = part.match(/^\r?\n/);
          partBodyOffset = lead ? lead[0].length : 0;
        }
        const partLatin = part.substring(partBodyOffset);

        const partHeaders = this.parseHeaderBlock(partHeadersBlock)

        // A fragment whose "headers" block is non-empty but contains no
        // "key: value" lines is stray boundary-adjacent text, not a part.
        if (partHeadersBlock.trim() !== '' && Object.keys(partHeaders).length === 0) continue

        // Find byte offset of part body in bodyBuf. Bound the buffer to THIS
        // part's end (minus the CRLF that belongs to the next boundary) —
        // otherwise every part's body ran to the end of the whole message and
        // swallowed all following parts (headers, boundaries, next bodies).
        const fullPartStart = bodyLatin.indexOf(part);
        const partBodyStart = fullPartStart + partBodyOffset;
        // Account for trailing CRLF before next boundary (skip it for body extraction)
        const trailingCrlf = partLatin.match(/\r?\n$/) ? partLatin.match(/\r?\n$/)![0].length : 0;
        const partBuf = bodyBuf.subarray(partBodyStart, fullPartStart + part.length - trailingCrlf);

        processBodyPart(partLatin, partBuf, partHeaders)
      }
    } else {
      // Simple single-part message
      const encoding = headers['Content-Transfer-Encoding'] || '';
      const charset = topCharset || 'utf-8';
      const decoded = this.decodeBodyToString(bodyBuf, encoding, charset);
      if (contentType.toLowerCase().includes('text/html')) {
        htmlBody = decoded;
      } else {
        textBody = decoded;
      }
    }

    // Last-resort: if the structural parse yielded no body at all but the
    // message does carry data, surface it rather than rendering "(Пустое
    // письмо)" for a perfectly readable email.
    if (!textBody && !htmlBody) {
      // Case 1: a text part was misclassified as an attachment (e.g. the body
      // arrived with "Content-Disposition: attachment" and no filename).
      const textAtt = attachments.find((a) => a.mimeType.toLowerCase().startsWith('text/'));
      if (textAtt) {
        textBody = textAtt.data.toString('utf-8');
      } else if (bodyBuf.length > 0) {
        // Case 2: unknown/unparseable structure — decode the whole body and
        // strip boundary delimiters and part headers so it stays readable.
        const encoding = headers['Content-Transfer-Encoding'] || this.sniffTransferEncoding(bodyBuf);
        const decoded = this.decodeBodyToString(bodyBuf, encoding, topCharset || 'utf-8');
        const blobBoundary = effectiveBoundary || boundary;
        const boundaryLine = blobBoundary ? new RegExp(`^--${this.escapeRegex(blobBoundary)}(--)?[ \\t]*$`) : null;
        const tokenRe = blobBoundary ? new RegExp(`\\s*--${this.escapeRegex(blobBoundary)}(--)?`, 'g') : null;
        // The MIME preamble (everything before the first boundary delimiter
        // line) is scaffolding, never message content — drop it, but only when
        // real parts follow: if the only delimiter is the closing one, the
        // "preamble" is all the message has and dropping it would blank it.
        let cleaned = decoded;
        if (blobBoundary) {
          const delimRe = new RegExp(`^--${this.escapeRegex(blobBoundary)}(--)?[ \\t]*$`, 'm');
          const delimMatch = cleaned.match(delimRe);
          if (delimMatch && delimMatch.index !== undefined && delimMatch.index > 0 && !delimMatch[1]) {
            const rest = cleaned.substring(delimMatch.index + delimMatch[0].length);
            const closingRe = new RegExp(`^--${this.escapeRegex(blobBoundary)}--[ \\t]*$`, 'm');
            if (closingRe.test(rest)) {
              cleaned = cleaned.substring(delimMatch.index);
            }
          }
        }
        cleaned = cleaned
          .split(/\r?\n/)
          .filter((l) => !(boundaryLine && boundaryLine.test(l)))
          .filter((l) => !/^(content-type|content-transfer-encoding|content-disposition|content-id|mime-version)\s*:/i.test(l))
          .join('\r\n');
        // Boundary delimiters glued mid-line survive the line filter — remove
        // the tokens themselves.
        if (tokenRe) cleaned = cleaned.replace(tokenRe, '');
        cleaned = cleaned.trim();
        if (cleaned) {
          if (contentType.toLowerCase().includes('text/html')) {
            htmlBody = cleaned;
          } else {
            textBody = cleaned;
          }
        }
      }
    }

    // Decode MIME-encoded header values (e.g. =?UTF-8?B?...?=)
    for (const key of ['Subject', 'From', 'To', 'Cc', 'Reply-To', 'Bcc']) {
      if (headers[key]) {
        headers[key] = this.decodeMimeHeader(headers[key])
      }
    }

    return { headers, textBody, htmlBody, attachments }
  }

  /**
   * Undo Content-Transfer-Encoding (base64 / quoted-printable / 7bit / 8bit / binary)
   * and return the raw decoded bytes as a Buffer.
   * Used both for charset-aware body decoding and for binary attachment extraction.
   */
  private decodeTransferEncoding(buf: Buffer, encoding: string): Buffer {
    const enc = (encoding || '').toLowerCase().trim();

    if (enc === 'base64') {
      try {
        // base64 content may contain whitespace (CRLF); strip it
        const cleaned = buf.toString('latin1').replace(/\s/g, '');
        return Buffer.from(cleaned, 'base64');
      } catch {
        return buf;
      }
    }

    if (enc === 'quoted-printable') {
      // Decode QP to bytes from latin1 view (byte-safe for multi-byte content)
      const latin = buf.toString('latin1').replace(/=\r?\n/g, '') // soft line breaks → empty;
      const bytes: number[] = [];
      for (let i = 0; i < latin.length; i++) {
        if (latin[i] === '=' && i + 2 < latin.length) {
          const hex = latin.substring(i + 1, i + 3);
          if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
            bytes.push(parseInt(hex, 16))
            i += 2
          } else {
            bytes.push(latin.charCodeAt(i))
          }
        } else {
          bytes.push(latin.charCodeAt(i))
        }
      }
      return Buffer.from(bytes);
    }

    // 7bit, 8bit, binary, or unknown → bytes as-is
    return buf;
  }

  /**
   * Decode body to a UTF-8 string based on Content-Transfer-Encoding and charset.
   * Works with the original raw Buffer so that non-UTF-8 charsets (windows-1251, koi8-r, etc.)
   * are properly converted via iconv-lite instead of producing mojibake.
   */
  private decodeBodyToString(buf: Buffer, encoding: string, charset: string): string {
    // First: undo Content-Transfer-Encoding → raw bytes as Buffer
    const rawBytes = this.decodeTransferEncoding(buf, encoding);

    // Second: apply charset → UTF-8 via iconv-lite
    const normalizedCharset = this.normalizeCharset(charset);
    try {
      const iconv = require('iconv-lite');
      if (iconv.encodingExists(normalizedCharset)) {
        return iconv.decode(rawBytes, normalizedCharset);
      }
    } catch {
      // fall through
    }

    // Fallback: treat as UTF-8
    return rawBytes.toString('utf-8');
  }

  /**
   * Extract a filename from a Content-Disposition or Content-Type header value.
   * Supports:
   *   - filename="report.pdf" / name="photo.jpg"
   *   - RFC 2231 extended: filename*=UTF-8''%D0%A4%D0%B0%D0%B9%D0%BB.pdf
   */
  private extractFilename(headerValue: string): string | null {
    // RFC 2231 extended form takes priority (may carry non-ASCII names)
    const ext = headerValue.match(/(?:filename|name)\*\s*=\s*([^;]+)/i);
    if (ext) {
      const raw = ext[1].trim().replace(/^["']|["']$/g, '');
      // Format: charset'lang'percent-encoded  → decode the percent-encoded tail
      const m = raw.match(/^[^']*'[^']*'(.*)$/);
      const encoded = m ? m[1] : raw;
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    }

    const plain =
      headerValue.match(/(?:filename|name)\s*=\s*"([^"]+)"/i) ||
      headerValue.match(/(?:filename|name)\s*=\s*'([^']+)'/i) ||
      headerValue.match(/(?:filename|name)\s*=\s*([^"';\s]+)/i);
    return plain ? plain[1] : null;
  }

  /**
   * Extract charset from a Content-Type header value.
   * e.g. "text/plain; charset=windows-1251" → "windows-1251"
   */
  private extractCharset(contentType: string): string | null {
    const match = contentType.match(/charset=["']?([^"';\s]+)["']?/i);
    return match ? match[1] : null;
  }

  /**
   * Recover the multipart boundary when the top-level Content-Type header was
   * stripped/corrupted by a relay. Three evidence sources, most trusted first:
   * 1. an in-body "boundary=..." declaration whose token is actually used as
   *    a delimiter (the mangled Content-Type parameter glued to the preamble);
   * 2. delimiter lines at line starts (well-formed but headerless multipart);
   * 3. "--token" delimiters glued mid-line (a relay collapsed the newlines).
   */
  private detectBoundaryFromBody(bodyLatin: string): string | null {
    // 1) Explicit declaration + proof it is used as a delimiter.
    const declared = bodyLatin.match(/boundary=["']?([A-Za-z0-9'()+_\-./:=?]{3,70})["']?/i);
    if (declared && this.bodyHasBoundary(bodyLatin, declared[1])) {
      return declared[1];
    }

    const counts = new Map<string, { total: number; closing: number }>();
    const bump = (token: string, closing: boolean): void => {
      if (!token) return;
      const entry = counts.get(token) || { total: 0, closing: 0 };
      entry.total++;
      if (closing) entry.closing++;
      counts.set(token, entry);
    };

    // 2) Delimiter lines at line starts.
    for (const line of bodyLatin.match(/^--[A-Za-z0-9'()+_,\-./:=? ]{1,70}$/gm) || []) {
      const token = line.replace(/\s+$/, '');
      if (token.endsWith('--')) bump(token.slice(2, -2), true);
      else bump(token.slice(2), false);
    }

    // 3) Delimiters glued mid-line. The token must be alphanumeric and appear
    // both as separators and with the closing "--" suffix, at least 3 times —
    // this rejects stray "--" inside base64url query parameters.
    for (const m of bodyLatin.matchAll(/--([A-Za-z0-9]{8,70})(--)?/g)) {
      bump(m[1], !!m[2]);
    }

    let best: string | null = null;
    let bestTotal = 0;
    for (const [token, { total, closing }] of counts) {
      // A real boundary separates parts AND closes the message.
      if (total >= 3 && closing >= 1 && total > bestTotal) {
        best = token;
        bestTotal = total;
      }
    }
    return best;
  }

  /** True when `--token` occurs ≥2 times and the closing `--token--` exists. */
  private bodyHasBoundary(body: string, token: string): boolean {
    if (body.split(`--${token}`).length - 1 < 2) return false;
    return body.split(`--${token}--`).length - 1 >= 1;
  }

  /**
   * Guess the Content-Transfer-Encoding of a headerless part from its bytes.
   * Base64 is checked first (a QP soft break "=\r\n" looks identical to base64
   * padding at end of line); quoted-printable requires several =XX triplets or
   * a real soft break — a lone =XX (e.g. a URL query value) is not evidence.
   */
  private sniffTransferEncoding(buf: Buffer): string {
    const latin = buf.toString('latin1');
    const compact = latin.replace(/\s+/g, '');
    if (compact.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
      return 'base64';
    }
    const qpHits = (latin.match(/=[0-9A-Fa-f]{2}/g) || []).length;
    if (/=[\r\n]/.test(latin) || qpHits >= 4) {
      return 'quoted-printable';
    }
    return '';
  }

  /**
   * Guess whether a decoded body is HTML or plain text (for headerless parts):
   * an opening HTML tag at any point marks it as HTML.
   */
  private sniffContentType(decoded: string): string {
    return /<\s*(?:!DOCTYPE\s+)?html[\s>]/i.test(decoded) || /<\s*(?:body|div|p|table|tr|td|br|img|span|font)[\s/>]/i.test(decoded)
      ? 'text/html'
      : 'text/plain';
  }

  /**
   * Normalize charset name to iconv-lite recognized format.
   */
  private normalizeCharset(charset: string): string {
    const c = charset.toLowerCase().trim();
    // Common aliases
    const aliases: Record<string, string> = {
      '': 'utf-8',
      'utf8': 'utf-8',
      'us-ascii': 'ascii',
      'ascii': 'ascii',
      'win1251': 'windows-1251',
      'cp1251': 'windows-1251',
      'windows-1251': 'windows-1251',
      'koi8': 'koi8-r',
      'koi8r': 'koi8-r',
      'koi8-r': 'koi8-r',
      'iso-8859-5': 'iso-8859-5',
    }
    return aliases[c] || c || 'utf-8';
  }

  /**
   * Decode MIME-encoded header values (e.g. =?UTF-8?B?...?= or =?UTF-8?Q?...?=)
   */
  private decodeMimeHeader(encoded: string): string {
    try {
      // Use libmime if available, otherwise manual fallback
      const libmime = require('libmime');
      const Libmime = libmime.Libmime;
      const inst = new Libmime({});
      return inst.decodeWords(encoded);
    } catch {
      // Fallback: basic =?UTF-8?B?...?= decoding
      return encoded.replace(/=\?([^?]+)\?([BQ])\?([^?]+)\?=/gi, (_match, _charset: string, encoding: string, content: string) => {
        try {
          if (encoding.toUpperCase() === 'B') {
            return Buffer.from(content, 'base64').toString('utf-8');
          } else {
            // Q-encoding: =XX hex, _ = space
            return content
              .replace(/_/g, ' ')
              .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
          }
        } catch {
          return content;
        }
      })
    }
  }

  /**
   * Replace <img src="cid:xxx"> references with inline data: URIs built from
   * matching inline attachments. Limits total inlined size to avoid bloating
   * the IPC payload with huge embedded images.
   */
  private inlineCidImages(html: string, attachments: AttachmentData[]): string {
    if (!html) return html
    const inlineParts = attachments.filter((a) => a.contentId && a.data && a.data.length > 0);
    if (inlineParts.length === 0) return html

    // Cap total embedded payload at ~15 MB to keep IPC responsive.
    const MAX_TOTAL_INLINE = 15 * 1024 * 1024;
    let budget = MAX_TOTAL_INLINE;

    return html.replace(
      /(<img\b[^>]*?\bsrc\s*=\s*["'])cid:([^"']+)(["'][^>]*>)/gi,
      (match, pre: string, cid: string, post: string) => {
        const decodedCid = cid.trim();
        const att = inlineParts.find(
          (a) => a.contentId === decodedCid || a.contentId === decodedCid.replace(/^<|>$/g, ''),
        )
        if (!att || att.data.length > budget) return match
        budget -= att.data.length
        const mime = att.mimeType || 'image/png';
        const base64 = att.data.toString('base64');
        return `${pre}data:${mime};base64,${base64}${post}`;
      },
    )
  }

  /**
   * Extract email address from a "Name <email>" header value.
   */
  private extractEmail(fromHeader: string): string {
    const match = fromHeader.match(/<([^>]+)>/);
    return match ? match[1] : fromHeader.trim();
  }

  /**
   * Escape special regex characters in a string.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export default ImapConnection