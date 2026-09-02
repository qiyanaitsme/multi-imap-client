import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ConfigParser } from './ConfigParser'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cfg-test-'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeTmp(name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, content, 'utf-8')
  return p
}

describe('ConfigParser.parseAccounts', () => {
  it('parses valid accounts and derives the domain', () => {
    const file = writeTmp(
      'accounts.txt',
      [
        '# comment',
        '',
        'user1@gmail.com:password123',
        'user2@yandex.ru:app-pass|socks5://127.0.0.1:1080',
      ].join('\n'),
    )

    const res = ConfigParser.parseAccounts(file)
    expect(res.success).toBe(true)
    expect(res.data).toHaveLength(2)
    expect(res.data[0]).toMatchObject({
      email: 'user1@gmail.com',
      password: 'password123',
      domain: 'gmail.com',
      proxyString: null,
    })
    expect(res.data[1]).toMatchObject({
      email: 'user2@yandex.ru',
      domain: 'yandex.ru',
      proxyString: 'socks5://127.0.0.1:1080',
    })
  })

  it('reports the line number for a malformed row (no colon)', () => {
    const file = writeTmp('bad.txt', ['good@mail.ru:pass', 'brokenline-no-colon'].join('\n'))
    const res = ConfigParser.parseAccounts(file)
    expect(res.success).toBe(false)
    expect(res.data).toHaveLength(1)
    expect(res.errors[0].line).toBe(2)
  })

  it('fails gracefully when the file does not exist', () => {
    const res = ConfigParser.parseAccounts(join(dir, 'nope.txt'))
    expect(res.success).toBe(false)
    expect(res.errors[0].message).toMatch(/не найден/i)
  })
})

describe('ConfigParser.parseProxyString', () => {
  it('parses a socks5 proxy with credentials', () => {
    const p = ConfigParser.parseProxyString('socks5://user:pass@proxy.example.com:1080')
    expect(p).toMatchObject({
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      user: 'user',
      pass: 'pass',
    })
  })

  it('parses an http proxy without credentials', () => {
    const p = ConfigParser.parseProxyString('http://proxy.example.com:8080')
    expect(p).toMatchObject({ type: 'http', host: 'proxy.example.com', port: 8080 })
    expect(p.user).toBeUndefined()
  })

  it('throws on an unsupported protocol', () => {
    expect(() => ConfigParser.parseProxyString('ftp://proxy:21')).toThrow(/протокол/i)
  })
})

describe('ConfigParser.resolveImapServer', () => {
  const servers = {
    'gmail.com': { host: 'imap.gmail.com', port: 993, tls: true },
    '*.example.org': { host: 'imap.catchall.example.org', port: 993, tls: true },
    '*': { host: 'imap.fallback.net', port: 993, tls: true },
  }

  it('resolves an exact domain match', () => {
    expect(ConfigParser.resolveImapServer('gmail.com', servers).host).toBe('imap.gmail.com')
  })

  it('resolves a suffix wildcard (*.example.org)', () => {
    expect(ConfigParser.resolveImapServer('mail.example.org', servers).host).toBe('imap.catchall.example.org')
  })

  it('falls back to the catch-all wildcard', () => {
    expect(ConfigParser.resolveImapServer('unknown.org', servers).host).toBe('imap.fallback.net')
  })

  it('auto-detects imap.{domain} when no config matches', () => {
    const r = ConfigParser.resolveImapServer('example.net', {})
    expect(r).toMatchObject({ host: 'imap.example.net', port: 993, tls: true })
  })
})
