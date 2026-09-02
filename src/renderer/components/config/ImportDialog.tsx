"use client"

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import FileDropZone from './FileDropZone'
import { Upload, FileText, Server, Globe, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useAccountStore } from '@/store/useAccountStore'
import type { Account } from '@/lib/types'

interface ImportError {
  line: number
  message: string
}

interface AccParsed {
  id?: string
  email: string
  domain: string
  proxy: string | null
}

export default function ImportDialog(): React.JSX.Element {
  const [accountsPreview, setAccountsPreview] = useState<AccParsed[]>([])
  const [accountsErrors, setAccountsErrors] = useState<ImportError[]>([])
  const [imapServersPreview, setImapServersPreview] = useState<Record<string, any>>({})
  const [imapErrors, setImapErrors] = useState<string[]>([])
  const [proxiesPreview, setProxiesPreview] = useState<string[]>([])
  const [proxiesErrors, setProxiesErrors] = useState<ImportError[]>([])
  const [showPasswords, setShowPasswords] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  const { setAccounts } = useAccountStore()

  // File picker for accounts.txt
  const handleSelectAccounts = useCallback(async () => {
    setLoading('accounts')
    try {
      const filePath = await window.electronAPI?.selectFile({
        filters: [{ name: 'Text', extensions: ['txt'] }],
      })
      if (!filePath) return
      const res = await window.electronAPI?.loadAccounts(filePath)
      if (res?.success) {
        setAccountsPreview(res.data || [])
        setAccountsErrors(res.errors || [])
        toast.success(`Загружено: ${(res.data || []).length} аккаунтов`)
      } else {
        setAccountsErrors(res?.errors || [])
        toast.error('Ошибки при разборе accounts.txt')
      }
    } catch (e) {
      toast.error('Не удалось загрузить файл аккаунтов')
    } finally {
      setLoading(null)
    }
  }, [])

  // File picker for imap-servers.json
  const handleSelectImapServers = useCallback(async () => {
    setLoading('imap')
    try {
      const filePath = await window.electronAPI?.selectFile({
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (!filePath) return
      const res = await window.electronAPI?.loadImapServers(filePath)
      if (res?.success) {
        setImapServersPreview(res.data || {})
        setImapErrors([])
        toast.success(`Загружено: ${Object.keys(res.data || {}).length} серверов`)
      } else {
        setImapErrors((res?.errors || []).map((e: any) => e.message))
        toast.error('Ошибки при разборе imap-servers.json')
      }
    } catch (e) {
      toast.error('Не удалось загрузить IMAP-серверы')
    } finally {
      setLoading(null)
    }
  }, [])

  // File picker for proxies.txt
  const handleSelectProxies = useCallback(async () => {
    setLoading('proxies')
    try {
      const filePath = await window.electronAPI?.selectFile({
        filters: [{ name: 'Text', extensions: ['txt'] }],
      })
      if (!filePath) return
      const res = await window.electronAPI?.loadProxies(filePath)
      if (res?.success) {
        setProxiesPreview((res.data || []).map((p: any) => p.raw))
        setProxiesErrors(res.errors || [])
        toast.success(`Загружено: ${(res.data || []).length} прокси`)
      } else {
        setProxiesErrors(res?.errors || [])
        toast.error('Ошибки при разборе proxies.txt')
      }
    } catch (e) {
      toast.error('Не удалось загрузить прокси-файл')
    } finally {
      setLoading(null)
    }
  }, [])

  // Drop file → detect type by extension/name.
  // Smart routing by file name: *accounts*.txt / proxies.txt / *.json (imap-servers).
  // Primary flow parses CONTENT (dropped files may have no resolvable OS path);
  // if content is missing (read failed), falls back to the path-based flow.
  const handleDropFile = useCallback(async (filePath: string, fileName: string, content?: string) => {
    const name = fileName.toLowerCase()

    const isProxy = name.includes('proxy')
    const isImap = name.endsWith('.json') || name.includes('imap') || name.includes('server')
    const isAccounts = name.includes('account') || (!isProxy && !isImap)

    if (content === undefined) {
      if (!filePath) {
        toast.error(`Не удалось прочитать файл: ${fileName}`)
        return
      }
      // Path-based fallback (mirrors the "Выбрать файл" flow)
      try {
        if (isAccounts) {
          setLoading('accounts')
          const res = await window.electronAPI?.loadAccounts(filePath)
          if (res?.success) {
            setAccountsPreview(res.data || [])
            setAccountsErrors(res.errors || [])
            toast.success(`Загружено: ${(res.data || []).length} аккаунтов`)
          } else {
            toast.error(res?.errors?.[0]?.message || 'Не удалось разобрать файл аккаунтов')
          }
        } else if (isImap) {
          setLoading('imap')
          const res = await window.electronAPI?.loadImapServers(filePath)
          if (res?.success) {
            setImapServersPreview(res.data || {})
            setImapErrors([])
            toast.success(`Загружено: ${Object.keys(res.data || {}).length} серверов`)
          } else {
            setImapErrors((res?.errors || []).map((e: any) => e.message))
            toast.error('Ошибки при разборе imap-servers.json')
          }
        } else if (isProxy) {
          setLoading('proxies')
          const res = await window.electronAPI?.loadProxies(filePath)
          if (res?.success) {
            setProxiesPreview((res.data || []).map((p: any) => p.raw))
            setProxiesErrors(res.errors || [])
            toast.success(`Загружено: ${(res.data || []).length} прокси`)
          } else {
            setProxiesErrors(res?.errors || [])
            toast.error('Ошибки при разборе proxies.txt')
          }
        }
      } finally {
        setLoading(null)
      }
      return
    }

    // Content-based flow
    if (!content.trim()) {
      toast.error(`Файл пустой: ${fileName}`)
      return
    }

    try {
      if (isAccounts) {
        setLoading('accounts')
        const res = await window.electronAPI?.loadAccountsContent(content, fileName)
        if (res?.success) {
          setAccountsPreview(res.data || [])
          setAccountsErrors(res.errors || [])
          toast.success(`Загружено: ${(res.data || []).length} аккаунтов`)
          return
        }
        // A JSON file misrouted here (no "imap" in its name) — try imap-servers
        // before reporting an accounts parsing error.
        if (content.trim().startsWith('{')) {
          const imapRes = await window.electronAPI?.loadImapServersContent(content, fileName)
          if (imapRes?.success && Object.keys(imapRes.data || {}).length > 0) {
            setImapServersPreview(imapRes.data || {})
            setImapErrors([])
            toast.success(`Загружено: ${Object.keys(imapRes.data || {}).length} серверов`)
            return
          }
        }
        setAccountsErrors(res?.errors || [])
        toast.error(res?.errors?.[0]?.message || 'Не удалось разобрать файл аккаунтов')
      } else if (isImap) {
        setLoading('imap')
        const res = await window.electronAPI?.loadImapServersContent(content, fileName)
        if (res?.success) {
          setImapServersPreview(res.data || {})
          setImapErrors([])
          toast.success(`Загружено: ${Object.keys(res.data || {}).length} серверов`)
        } else {
          setImapErrors((res?.errors || []).map((e: any) => e.message))
          toast.error('Ошибки при разборе imap-servers.json')
        }
      } else if (isProxy) {
        setLoading('proxies')
        const res = await window.electronAPI?.loadProxiesContent(content, fileName)
        if (res?.success) {
          setProxiesPreview((res.data || []).map((p: any) => p.raw))
          setProxiesErrors(res.errors || [])
          toast.success(`Загружено: ${(res.data || []).length} прокси`)
        } else {
          setProxiesErrors(res?.errors || [])
          toast.error('Ошибки при разборе proxies.txt')
        }
      }
    } finally {
      setLoading(null)
    }
  }, [])

  // Persist accounts to store + register them in main process for IMAP
  const handleApply = useCallback(async () => {
    if (accountsPreview.length === 0) {
      toast.error('Нет аккаунтов для применения')
      return
    }

    // Clear previously registered accounts so stale connections don't linger
    try {
      await window.electronAPI?.clearAccounts()
    } catch (e: any) {
      console.warn('clearAccounts error:', e?.message)
    }

    const accs: Account[] = accountsPreview.map((a, i) => ({
      id: a.id || `acc-${i + 1}`,
      email: a.email,
      domain: a.domain,
      status: 'offline' as const,
      proxy: a.proxy,
    }))
    setAccounts(accs)

    // Register each account in the main process so IMAP can connect later
    try {
      for (let i = 0; i < accountsPreview.length; i++) {
        const a = accountsPreview[i]
        // No password here by design — main resolves credentials from its
        // own cache (TechTask §8.2: passwords never reach the renderer).
        await window.electronAPI?.registerAccount({
          id: a.id || `acc-${i + 1}`,
          email: a.email,
          domain: a.domain,
          proxy: a.proxy,
        })
      }
    } catch (e: any) {
      console.warn('registerAccount error:', e?.message)
    }

    // Save imap servers and proxies via store (triggers syncSettingsToImapManager in main)
    // AWAIT is critical: without it, connectAll() races against the IPC round-trip
    // and may start before ImapManager has the server config — causing connections
    // to fall through to the auto-detect "imap.{domain}" fallback.
    try {
      await window.electronAPI?.setSettings({
        imapServers: imapServersPreview,
        proxies: proxiesPreview,
      })
    } catch (e: any) {
      console.warn('setSettings error:', e?.message)
    }

    toast.success(`Применено: ${accs.length} аккаунтов`)

    // Connect all — sequentially by domain, no hammering.
    // Settings are now guaranteed synced (awaited above), so no artificial delay needed.
    // A short 100ms tick lets the renderer update the account list UI first.
    setTimeout(async () => {
      toast.info('Подключение аккаунтов...')
      try {
        await window.electronAPI?.connectAll()
      } catch (e: any) {
        console.warn('auto-connectAll error:', e?.message)
      }
    }, 100)
  }, [accountsPreview, imapServersPreview, proxiesPreview, setAccounts])

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        <h2 className="text-base font-semibold">Импорт конфигурации</h2>

        {/* Drop Zone */}
        <Card>
          <CardContent className="pt-4">
            <FileDropZone onFileDropped={handleDropFile} />
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {/* Accounts import */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm">accounts.txt</CardTitle>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSelectAccounts}
                  disabled={loading === 'accounts'}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {loading === 'accounts' ? 'Загрузка...' : 'Выбрать файл'}
                </Button>
              </div>
              <CardDescription className="text-xs">
                email:password [| proxy] — одна строка, один аккаунт
              </CardDescription>
            </CardHeader>
            {accountsPreview.length > 0 && (
              <CardContent className="pt-0">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="secondary">Предпросмотр ({accountsPreview.length})</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="h-7 text-xs"
                  >
                    {showPasswords ? <EyeOff className="h-3 w-3 mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
                    {showPasswords ? 'Скрыть' : 'Показать'}
                  </Button>
                </div>
                <ScrollArea className="h-[180px] w-full rounded border bg-muted/30">
                  <div className="p-2 text-xs">
                    {accountsPreview.map((a, i) => (
                      <div key={i} className="flex items-center justify-between py-0.5 border-b border-border/50 last:border-0">
                        <span className="truncate">{showPasswords ? a.email : maskEmail(a.email)}</span>
                        <div className="flex items-center gap-2 pl-2">
                          {a.proxy && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1">{shortProxy(a.proxy)}</Badge>
                          )}
                          <Globe className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            )}
            {accountsErrors.length > 0 && (
              <CardContent className="pt-0">
                <Alert variant="destructive" className="py-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-sm">Ошибки парсинга ({accountsErrors.length})</AlertTitle>
                  <AlertDescription className="text-xs">
                    {accountsErrors.map((e, i) => (
                      <div key={i}>Строка {e.line}: {e.message}</div>
                    ))}
                  </AlertDescription>
                </Alert>
              </CardContent>
            )}
          </Card>

          {/* IMAP servers */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm">imap-servers.json</CardTitle>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSelectImapServers}
                  disabled={loading === 'imap'}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {loading === 'imap' ? 'Загрузка...' : 'Выбрать файл'}
                </Button>
              </div>
              <CardDescription className="text-xs">
                Маппинг домен → IMAP-сервер
              </CardDescription>
            </CardHeader>
            {Object.keys(imapServersPreview).length > 0 && (
              <CardContent className="pt-0">
                <ScrollArea className="h-[120px] w-full rounded border bg-muted/30">
                  <div className="p-2 text-xs space-y-1">
                    {Object.entries(imapServersPreview).map(([domain, srv]: [string, any]) => (
                      <div key={domain} className="flex items-center justify-between border-b border-border/50 pb-1 last:border-0">
                        <span className="font-mono">{domain}</span>
                        <span className="text-muted-foreground">{srv.host}:{srv.port}{srv.tls ? ' (TLS)' : ''}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            )}
            {imapErrors.length > 0 && (
              <CardContent className="pt-0">
                <Alert variant="destructive" className="py-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-sm">Ошибки JSON</AlertTitle>
                  <AlertDescription className="text-xs">{imapErrors.join(', ')}</AlertDescription>
                </Alert>
              </CardContent>
            )}
          </Card>

          {/* Proxies */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm">proxies.txt</CardTitle>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSelectProxies}
                  disabled={loading === 'proxies'}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {loading === 'proxies' ? 'Загрузка...' : 'Выбрать файл'}
                </Button>
              </div>
              <CardDescription className="text-xs">
                protocol://[user:pass@]host:port — общий пул прокси
              </CardDescription>
            </CardHeader>
            {proxiesPreview.length > 0 && (
              <CardContent className="pt-0">
                <ScrollArea className="h-[100px] w-full rounded border bg-muted/30">
                  <div className="p-2 text-xs space-y-0.5">
                    {proxiesPreview.map((p, i) => (
                      <div key={i} className="truncate font-mono">{p}</div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            )}
            {proxiesErrors.length > 0 && (
              <CardContent className="pt-0">
                <Alert variant="destructive" className="py-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-sm">Ошибки парсинга ({proxiesErrors.length})</AlertTitle>
                  <AlertDescription className="text-xs">
                    {proxiesErrors.map((e, i) => (
                      <div key={i}>Строка {e.line}: {e.message}</div>
                    ))}
                  </AlertDescription>
                </Alert>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Apply button */}
        <Button
          onClick={handleApply}
          disabled={accountsPreview.length === 0}
          className="w-full"
        >
          <CheckCircle2 className="h-4 w-4 mr-2" />
          Применить конфигурацию
        </Button>
      </div>
    </ScrollArea>
  )
}

// Helper: mask email at preview if showPasswords is off
function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!user || !domain) return email
  if (user.length <= 2) return `${user[0]}***@${domain}`
  return `${user[0]}${'*'.repeat(user.length - 2)}${user[user.length - 1]}@${domain}`
}

// Helper: truncate long proxy string for badge display
function shortProxy(proxy: string): string {
  if (proxy.length <= 24) return proxy
  return proxy.substring(0, 21) + '...'
}