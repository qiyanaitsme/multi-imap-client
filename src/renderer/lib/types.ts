// Shared types between main and renderer processes

export type AccountStatus = 'online' | 'offline' | 'connecting' | 'error'

export interface Account {
  id: string
  email: string
  password?: string       // Only in main process, never sent to renderer
  domain: string
  imapServer?: ImapServerConfig
  status: AccountStatus
  proxy: string | null     // Proxy string reference
  error?: string
  folders?: MailFolder[]
  lastFolder?: string
}

export interface ImapServerConfig {
  host: string
  port: number
  tls: boolean
  tlsOptions?: {
    rejectUnauthorized: boolean
  }
}

export interface ParsedProxy {
  type: 'socks5' | 'socks4' | 'http' | 'https'
  host: string
  port: number
  user?: string
  pass?: string
  raw: string               // Original proxy string
  status?: 'alive' | 'dead' | 'unknown'
  accountCount?: number
  isDirect?: boolean
  latencyMs?: number | null
  /** Last health-check failure reason (alive=false), null when alive. */
  error?: string | null // Tunnel round-trip latency from last check
}

export interface MailFolder {
  name: string
  fullPath: string
  delimiter: string
  children: MailFolder[]
}

export interface MailMessage {
  uid: string
  subject: string
  fromName: string
  fromEmail: string
  date: Date | string
  isRead: boolean
  isFlagged: boolean
  hasAttachments: boolean
  size: number
  preview?: string           // First line of text
}

export interface MailContent {
  uid: string
  subject: string
  fromName: string
  fromEmail: string
  to: string
  cc?: string
  bcc?: string
  replyTo?: string
  date: Date | string
  htmlBody: string
  textBody: string
  headers: Record<string, string>
  attachments: Attachment[]
}

export interface Attachment {
  id: string
  filename: string
  size: number
  mimeType: string
  contentDisposition: string
  contentId?: string
  /** True for inline (cid:) images embedded in the HTML body */
  isInline?: boolean
}

export interface PaginationParams {
  page: number
  pageSize: number         // 30 | 50 | 100
  sortOrder: 'asc' | 'desc'
}

export interface SearchParams {
  query: string
  field: 'subject' | 'from' | 'body' | 'all'
  folder?: string
}

export interface ProxyPoolConfig {
  proxies: ParsedProxy[]
  rotationStrategy: 'round-robin' | 'random' | 'least-used'
}

// IPC channel names
export const IPC_CHANNELS = {
  CONFIG: {
    LOAD_ACCOUNTS: 'config:load-accounts',
    LOAD_IMAP_SERVERS: 'config:load-imap-servers',
    LOAD_PROXIES: 'config:load-proxies',
    SAVE_CONFIG: 'config:save',
    VALIDATE: 'config:validate',
  },
  ACCOUNTS: {
    CONNECT: 'accounts:connect',
    DISCONNECT: 'accounts:disconnect',
    CONNECT_ALL: 'accounts:connect-all',
    DISCONNECT_ALL: 'accounts:disconnect-all',
    RECONNECT_ALL: 'accounts:reconnect-all',
    GET_STATUS: 'accounts:get-status',
    STATUS_CHANGED: 'accounts:status-changed',
    ASSIGN_PROXY: 'accounts:assign-proxy',
    MASS_ASSIGN_PROXY: 'accounts:mass-assign-proxy',
  },
  MAIL: {
    FETCH_FOLDERS: 'mail:fetch-folders',
    FETCH_MESSAGES: 'mail:fetch-messages',
    FETCH_CONTENT: 'mail:fetch-content',
    SEARCH: 'mail:search',
    SAVE_ATTACHMENT: 'mail:save-attachment',
    MARK_READ: 'mail:mark-read',
  },
  PROXY: {
    GET_ALL: 'proxy:get-all',
    CHECK: 'proxy:check',
    CHECK_ALL: 'proxy:check-all',
    ROTATE: 'proxy:rotate',
  },
  STORE: {
    GET: 'store:get',
    SET: 'store:set',
    DELETE: 'store:delete',
    GET_SECURE: 'store:get-secure',
    SET_SECURE: 'store:set-secure',
  },
} as const