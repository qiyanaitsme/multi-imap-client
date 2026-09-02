import * as fs from 'node:fs'
import * as path from 'node:path'
export type ParsedProxy = {
  type: 'socks5' | 'socks4' | 'http' | 'https'
  host: string
  port: number
  user?: string
  pass?: string
  raw: string
  status?: 'alive' | 'dead' | 'unknown'
  accountCount?: number
  isDirect?: boolean
}

/**
 * Supported IMAP server domains loaded from imap-servers.json
 */
interface ImapServerEntry {
  host: string
  port: number
  tls: boolean
}

interface ImapServersConfig {
  [domain: string]: ImapServerEntry
}

/**
 * Parsed account line from accounts.txt
 */
interface ParsedAccountLine {
  lineNumber: number
  email: string
  password: string
  proxyString: string | null
  domain: string
}

interface ParseResult<T> {
  success: boolean
  data: T
  errors: Array<{ line: number; message: string }>
}

/**
 * Parser for configuration files:
 * - accounts.txt: email:password per line, optional |proxy suffix
 * - imap-servers.json: domain to IMAP server mapping
 * - proxies.txt: proxy strings pool
 */
export class ConfigParser {
  /**
   * Parse accounts.txt contents.
   * Format: email:password[|proxy]
   * Lines starting with # are comments, empty lines ignored.
   */
  static parseAccounts(filePath: string): ParseResult<ParsedAccountLine[]> {
    const result: ParseResult<ParsedAccountLine[]> = {
      success: true,
      data: [],
      errors: [],
    }

    if (!fs.existsSync(filePath)) {
      result.success = false
      result.errors.push({ line: 0, message: `Файл не найден: ${filePath}` })
      return result
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    return ConfigParser.parseAccountsContent(content)
  }

  /**
   * Parse accounts.txt CONTENT directly. Drag-and-drop imports pass file
   * contents from the renderer — resolving an OS path for a dropped File is
   * unreliable (webUtils.getPathForFile returns '' in Electron 31).
   * Format: email:password[|proxy], # comments, empty lines ignored.
   */
  static parseAccountsContent(content: string): ParseResult<ParsedAccountLine[]> {
    const result: ParseResult<ParsedAccountLine[]> = {
      success: true,
      data: [],
      errors: [],
    }

    // Strip UTF-8 BOM — harmless for line parsing but keeps output clean.
    const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)

    for (let i = 0; i < lines.length; i++) {
      const lineNumber = i + 1
      const rawLine = lines[i].trim()

      // Skip empty lines and comments
      if (rawLine === '' || rawLine.startsWith('#')) {
        continue
      }

      try {
        // Parse: email:password[|proxy]
        const parts = rawLine.split('|')
        const credentials = parts[0]       // email:password
        const proxyString = parts.length > 1 ? parts[1].trim() : null

        const colonIndex = credentials.indexOf(':')
        if (colonIndex === -1) {
          result.errors.push({
            line: lineNumber,
            message: `Нет разделителя ':' между email и паролем: "${rawLine}"`,
          })
          result.success = false
          continue
        }

        const email = credentials.substring(0, colonIndex).trim()
        const password = credentials.substring(colonIndex + 1).trim()

        if (!email || !password) {
          result.errors.push({
            line: lineNumber,
            message: `Пустой email или пароль в строке: "${rawLine}"`,
          })
          result.success = false
          continue
        }

        // Extract domain from email
        const atIndex = email.lastIndexOf('@')
        if (atIndex === -1) {
          result.errors.push({
            line: lineNumber,
            message: `Некорректный email (нет @): "${email}"`,
          })
          result.success = false
          continue
        }
        const domain = email.substring(atIndex + 1).toLowerCase()

        // Validate proxy if present
        if (proxyString) {
          const proxyError = ConfigParser.validateProxyString(proxyString)
          if (proxyError) {
            result.errors.push({
              line: lineNumber,
              message: `Некорректный прокси: ${proxyError}`,
            })
            result.success = false
            continue
          }
        }

        result.data.push({
          lineNumber,
          email,
          password,
          proxyString,
          domain,
        })
      } catch (err) {
        result.errors.push({
          line: lineNumber,
          message: `Ошибка разбора строки: ${err instanceof Error ? err.message : String(err)}`,
        })
        result.success = false
      }
    }

    return result
  }

  /**
   * Parse imap-servers.json
   */
  static parseImapServers(filePath: string): ParseResult<ImapServersConfig> {
    const result: ParseResult<ImapServersConfig> = { success: true, data: {}, errors: [] }

    if (!fs.existsSync(filePath)) {
      result.success = false
      result.errors.push({ line: 0, message: `Файл не найден: ${filePath}` })
      return result
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    return ConfigParser.parseImapServersContent(content)
  }

  /**
   * Parse imap-servers.json CONTENT directly (drag-and-drop imports).
   */
  static parseImapServersContent(content: string): ParseResult<ImapServersConfig> {
    const result: ParseResult<ImapServersConfig> = { success: true, data: {}, errors: [] }

    try {
      // Strip UTF-8 BOM (\uFEFF) — Windows Notepad and some editors add it,
      // and JSON.parse() throws "Unexpected token '﻿'" on BOM-prefixed content.
      const cleanContent = content.replace(/^\uFEFF/, '')
      const parsed = JSON.parse(cleanContent) as ImapServersConfig

      // Validate entries
      for (const [domain, config] of Object.entries(parsed)) {
        if (!config.host || !config.port) {
          result.errors.push({
            line: 0,
            message: `Неполная конфигурация для домена "${domain}": требуется host и port`,
          })
          result.success = false
          continue
        }

        // Validate port is a valid number
        if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
          result.errors.push({
            line: 0,
            message: `Некорректный port для домена "${domain}": ${config.port} (должен быть 1-65535)`,
          })
          result.success = false
        }

        // Validate tls is boolean (coerce if truthy/falsy string from JSON)
        if (typeof config.tls !== 'boolean') {
          // Accept truthy/falsy values but warn
          ;(config as any).tls = !!config.tls
        }

        // Validate host is non-empty string
        if (typeof config.host !== 'string' || config.host.trim() === '') {
          result.errors.push({
            line: 0,
            message: `Пустой host для домена "${domain}"`,
          })
          result.success = false
        }
      }

      result.data = parsed
    } catch (err) {
      result.success = false
      result.errors.push({
        line: 0,
        message: `Ошибка парсинга JSON: ${err instanceof Error ? err.message : String(err)}`,
      })
    }

    return result
  }

  /**
   * Parse proxies.txt
   * Each line is a proxy string: protocol://[user:pass@]host:port
   */
  static parseProxies(filePath: string): ParseResult<ParsedProxy[]> {
    const result: ParseResult<ParsedProxy[]> = { success: true, data: [], errors: [] }

    if (!fs.existsSync(filePath)) {
      // proxies.txt is optional
      return result
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    return ConfigParser.parseProxiesContent(content)
  }

  /**
   * Parse proxies.txt CONTENT directly (drag-and-drop imports).
   * Each line is a proxy string: protocol://[user:pass@]host:port
   */
  static parseProxiesContent(content: string): ParseResult<ParsedProxy[]> {
    const result: ParseResult<ParsedProxy[]> = { success: true, data: [], errors: [] }

    // Strip UTF-8 BOM — harmless for line parsing but keeps output clean.
    const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)

    for (let i = 0; i < lines.length; i++) {
      const lineNumber = i + 1
      const rawLine = lines[i].trim()

      if (rawLine === '' || rawLine.startsWith('#')) continue

      try {
        const parsed = ConfigParser.parseProxyString(rawLine)
        result.data.push(parsed)
      } catch (err) {
        result.errors.push({
          line: lineNumber,
          message: `Ошибка разбора прокси: ${err instanceof Error ? err.message : String(err)}`,
        })
        result.success = false
      }
    }

    return result
  }

  /**
   * Parse a single proxy string.
   * Supported formats:
   *   socks5://host:port
   *   socks5://user:pass@host:port
   *   socks4://host:port
   *   socks4://user:pass@host:port
   *   http://host:port
   *   http://user:pass@host:port
   *   https://host:port
   *   https://user:pass@host:port
   */
  static parseProxyString(proxyString: string): ParsedProxy {
    const url = new URL(proxyString)

    const protocol = url.protocol.replace(':', '')
    if (!['socks5', 'socks4', 'http', 'https'].includes(protocol)) {
      throw new Error(`Неподдерживаемый протокол прокси: "${protocol}". Поддерживаются: socks5, socks4, http, https`)
    }

    const type = protocol as ParsedProxy['type']
    const host = url.hostname
    const port = parseInt(url.port) || 1080
    const user = url.username || undefined
    const pass = url.password || undefined

    if (!host) {
      throw new Error(`Не указан хост в строке: "${proxyString}"`)
    }

    return {
      type,
      host,
      port,
      user,
      pass,
      raw: proxyString,
      status: 'unknown',
      accountCount: 0,
    }
  }

  /**
   * Validate proxy format without parsing fully
   */
  static validateProxyString(proxyString: string): string | null {
    try {
      ConfigParser.parseProxyString(proxyString)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  /**
   * Get IMAP server config for a domain.
   *
   * Matching order:
   *   1. Exact domain match (e.g. "gmail.com" → entry under key "gmail.com")
   *   2. Suffix wildcard match — key starts with "*." (e.g. "*.example.org" matches "mail.example.org")
   *   3. Strict wildcard "*" — matches any domain (catch-all)
   *   4. Auto-detection fallback: imap.{domain}:993 with TLS
   */
  static resolveImapServer(
    domain: string,
    imapServers: ImapServersConfig,
  ): ImapServerEntry {
    // 1. Exact match
    if (imapServers[domain]) {
      return imapServers[domain]
    }

    // 2. Suffix wildcard — longest matching "*.suffix" wins (most specific)
    let bestSuffixMatch: ImapServerEntry | null = null
    let bestSuffixLen = 0
    for (const [key, config] of Object.entries(imapServers)) {
      if (key.startsWith('*.')) {
        const suffix = key.slice(1) // ".example.org"
        if (domain.endsWith(suffix) && suffix.length > bestSuffixLen) {
          bestSuffixMatch = config
          bestSuffixLen = suffix.length
        }
      }
    }
    if (bestSuffixMatch) {
      return bestSuffixMatch
    }

    // 3. Strict catch-all wildcard
    if (imapServers['*']) {
      return imapServers['*']
    }

    // 4. Auto-detection fallback
    return {
      host: `imap.${domain}`,
      port: 993,
      tls: true,
    }
  }
}

export type { ParsedAccountLine, ImapServerEntry, ImapServersConfig }
export default ConfigParser