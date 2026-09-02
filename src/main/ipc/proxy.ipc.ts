import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../renderer/lib/types'
import type { ParsedProxy } from '../../renderer/lib/types'
import { ConfigParser } from '../services/config/ConfigParser'

function safeHandle(channel: string, fn: (event: any, ...args: any[]) => any): void {
  try {
    ipcMain.handle(channel, fn)
  } catch (e: any) {
    if (!String(e?.message || '').includes('second handler')) throw e
    console.warn(`[proxy.ipc] channel already registered: ${channel}`)
  }
}

interface ProxyState {
  proxyPool: ParsedProxy[]
}

let state: ProxyState = { proxyPool: [] }

export function setProxyPool(proxies: ParsedProxy[]): void {
  state = { proxyPool: proxies }
}

export function registerProxyIpc(_mainWindow: BrowserWindow): void {
  // Get all proxies
  safeHandle(IPC_CHANNELS.PROXY.GET_ALL, async () => {
    try {
      return {
        success: true,
        data: state.proxyPool.map((p) => ({
          ...p,
          user: p.user ? p.user : undefined,
          pass: undefined,
        })),
      }
    } catch (err) {
      return { success: false, error: String(err), data: [] }
    }
  })

  // Check single proxy (proxyString as argument)
  safeHandle(IPC_CHANNELS.PROXY.CHECK, async (_event, proxyString: string) => {
    try {
      const proxy = ConfigParser.parseProxyString(proxyString)
      const result = await testProxy(proxy)
      return { success: true, alive: result.alive, latencyMs: result.latencyMs, error: result.error ?? null }
    } catch (err) {
      return { success: false, alive: false, error: String(err) }
    }
  })

  // Check all proxies (bounded concurrency to avoid opening hundreds of sockets)
  safeHandle(IPC_CHANNELS.PROXY.CHECK_ALL, async () => {
    try {
      const results: Array<{ raw: string; alive: boolean; latencyMs: number | null }> = []
      const checkPromises = state.proxyPool.map(async (proxy) => {
        const { alive, latencyMs, error } = await testProxy(proxy)
        proxy.status = alive ? 'alive' : 'dead'
          if (!alive) {
            proxy.error = error ?? null
          } else {
            proxy.error = null
          }
        return { raw: proxy.raw, alive, latencyMs, error: proxy.error }
      })

      const checkResults = await Promise.allSettled(checkPromises)
      for (const r of checkResults) {
        if (r.status === 'fulfilled') results.push(r.value)
      }

      return { success: true, data: results }
    } catch (err) {
      return { success: false, error: String(err), data: [] }
    }
  })
}

/**
 * Tunnel-test targets tried in order; the FIRST successful SOCKS/CONNECT
 * tunnel marks the proxy alive. Gmail actively resets connections from
 * Tor exit nodes and some datacenter ranges, so testing ONLY against
 * imap.gmail.com produced false negatives for perfectly healthy proxies.
 * 1.1.1.1:443 (Cloudflare) accepts tunnels from virtually any network.
 */
const TEST_TARGETS: Array<{ host: string; port: number }> = [
  { host: 'imap.gmail.com', port: 993 },
  { host: '1.1.1.1', port: 443 },
]
const PROXY_TEST_TIMEOUT_MS = 12_000

interface ProxyTestResult {
    alive: boolean
  latencyMs: number | null

  /** Human-readable reason when alive=false (last tunnel error). */
  error?: string | null
}

/**
 * Verify a proxy actually TUNNELS traffic (not just that its port is open).
 *  - socks4/socks5 → establish a SOCKS connection to a TEST_TARGETS entry via the `socks` lib
 *  - http/https    → issue an HTTP CONNECT to a TEST_TARGETS entry
 * Measures round-trip latency of establishing the tunnel.
 */
async function testProxy(proxy: ParsedProxy): Promise<ProxyTestResult> {
  let lastErrorMessage: string | null = null
  const start = Date.now()
  try {
    let lastErr: unknown = null
    for (const target of TEST_TARGETS) {
      try {
        if (proxy.type === 'socks4' || proxy.type === 'socks5') {
          await testSocksProxy(proxy, target)
        } else {
          await testHttpConnectProxy(proxy, target)
        }
        return { alive: true, latencyMs: Date.now() - start }
      } catch (err) {
      lastErr = err
      lastErrorMessage = err instanceof Error ? err.message : String(err)
        // Try the next target — this one may block our source network
      }
    }
    void lastErr
    return { alive: false, latencyMs: null, error: lastErrorMessage }
  } catch {
    return { alive: false, latencyMs: null, error: lastErrorMessage }
  }
}
/** Establish a SOCKS tunnel to a TEST_TARGETS entry and immediately close it. */
async function testSocksProxy(proxy: ParsedProxy, target: { host: string; port: number }): Promise<void> {
  const { SocksClient } = require('socks')
  const { info } = await SocksClient.createConnection({
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: proxy.type === 'socks4' ? 4 : 5,
      userId: proxy.user,
      password: proxy.pass,
    },
    command: 'connect',
    destination: { host: target.host, port: target.port },
    timeout: PROXY_TEST_TIMEOUT_MS,
  })
  info.socket.destroy()
}

/** Issue an HTTP CONNECT through an http/https proxy to a TEST_TARGETS entry. */
async function testHttpConnectProxy(proxy: ParsedProxy, target: { host: string; port: number }): Promise<void> {
  const net = require('node:net')
  await new Promise<void>((resolve, reject) => {
    const socket = new net.Socket()
    let settled = false
    const done = (err?: Error): void => {
      if (settled) return
      settled = true
      socket.destroy()
      err ? reject(err) : resolve()
    }

    socket.setTimeout(PROXY_TEST_TIMEOUT_MS, () => done(new Error('timeout')))
    socket.on('error', (e: Error) => done(e))

    socket.connect(proxy.port, proxy.host, () => {
      const auth = proxy.user
        ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.user}:${proxy.pass ?? ''}`).toString('base64')}\r\n`
        : ''
  const dest = `${target.host}:${target.port}`
      socket.write(`CONNECT ${dest} HTTP/1.1\r\nHost: ${dest}\r\n${auth}\r\n`)
    })

    socket.on('data', (chunk: Buffer) => {
      const statusLine = chunk.toString('latin1').split('\r\n')[0]
      // Expect "HTTP/1.1 200 Connection established"
      if (/\s200\s/.test(statusLine)) done()
      else done(new Error(`Proxy CONNECT failed: ${statusLine}`))
    })
  })
}