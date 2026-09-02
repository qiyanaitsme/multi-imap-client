"use client"

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Users2, Globe, Upload, CheckCircle2, XCircle, Activity, Shield, Server, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAccountStore } from '@/store/useAccountStore'
import type { ParsedProxy } from '@/lib/types'

export default function ProxyManager(): React.JSX.Element {
  const [proxies, setProxies] = useState<ParsedProxy[]>([])
  const [isChecking, setIsChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [isAssigning, setIsAssigning] = useState(false)
  const accounts = useAccountStore((s) => s.accounts)

  useEffect(() => { loadProxies() }, [])

  const loadProxies = useCallback(async () => {
    const settings = await window.electronAPI?.getSettings()
    const rawProxies: string[] = settings?.proxies || []

    const proxyUrl = (raw: string): ParsedProxy => {
      try {
        const u = new URL(raw)
        return {
          type: u.protocol.replace(':', '') as ParsedProxy['type'],
          host: u.hostname,
          port: parseInt(u.port) || 1080,
          user: u.username || undefined,
          pass: u.password || undefined,
          raw,
          status: 'unknown' as const,
          accountCount: 0,
        }
      } catch {
        return {
          type: 'http',
          host: 'invalid',
          port: 0,
          raw,
          status: 'dead' as const,
          accountCount: 0,
        }
      }
    }
    setProxies(rawProxies.map(proxyUrl))
  }, [])

  const handleImportProxies = useCallback(async () => {
    const filePath = await window.electronAPI?.selectFile({
      filters: [{ name: 'Text', extensions: ['txt'] }],
    })
    if (!filePath) return
    const res = await window.electronAPI?.loadProxies(filePath)
    if (res?.success) {
      {
          // Dedup: same proxy may appear multiple times in the file
          const seen = new Set<string>()
          const uniq = (res.data || []).filter((p: any) => (seen.has(p.raw) ? false : (seen.add(p.raw), true)))
          setProxies(uniq)
        }
      const settings = await window.electronAPI?.getSettings()
      await window.electronAPI?.setSettings({ ...settings, proxies: (res.data || []).map((p: any) => p.raw) })
      toast.success(`Загружено прокси: ${(res.data || []).length}`)
    } else {
      toast.error('Ошибка при импорте прокси')
    }
  }, [])

  /**
   * Round-robin assignment of the loaded pool across all accounts.
   * Importing a pool alone does NOT attach proxies to accounts — that
   * binding normally comes from accounts.txt (`email:pass|proxy`).
   * This gives the same result when proxies are imported standalone.
   */
  const handleAssignToAccounts = useCallback(async () => {
    if (proxies.length === 0) {
      toast.error('Пул прокси пуст — сначала импортируйте proxies.txt')
      return
    }
    if (accounts.length === 0) {
      toast.error('Нет аккаунтов — сначала импортируйте accounts.txt')
      return
    }
    setIsAssigning(true)
    try {
      let ok = 0
      for (let i = 0; i < accounts.length; i++) {
        // Prefer alive proxies first, keep pool order as tie-breaker
        const ordered = [...proxies].sort((a, b) => (b.status === 'alive' ? 1 : 0) - (a.status === 'alive' ? 1 : 0))
        const target = ordered[i % ordered.length]
        const res = await window.electronAPI?.assignProxy(accounts[i].id, target.raw)
        if (res?.success) ok++
      }
      toast.success(`Прокси назначены: ${ok}/${accounts.length} аккаунтов`)
    } catch (e: any) {
      toast.error(`Не удалось назначить прокси: ${e?.message ?? ''}`)
    } finally {
      setIsAssigning(false)
    }
  }, [proxies, accounts])

  const handleCheckAll = useCallback(async () => {
    setIsChecking(true)
    try {
      // Real tunnel test in the main process (returns alive + latency per proxy).
      const res = await window.electronAPI?.checkAllProxies()
      const results: Array<{ raw: string; alive: boolean; latencyMs: number | null; error?: string | null }> =
        res?.data || []
      const byRaw = new Map(results.map((r) => [r.raw, r]))
      setProxies((prev) =>
        prev.map((p) => {
          const r = byRaw.get(p.raw)
          if (!r) return p
          return { ...p, status: r.alive ? ('alive' as const) : ('dead' as const), latencyMs: r.latencyMs, error: r.error ?? null }
        }),
      )
      setCheckedAt(new Date().toLocaleString('ru'))
      const alive = results.filter((r) => r.alive).length
      toast.success(`Проверка завершена: ${alive}/${results.length} живых`)
    } catch {
      toast.error('Ошибка при проверке прокси')
    } finally {
      setIsChecking(false)
    }
  }, [])

  const handleCheckOne = useCallback(async (raw: string) => {
    // Optimistic "checking" indicator
    setProxies((prev) => prev.map((p) => (p.raw === raw ? { ...p, status: 'unknown' } : p)))
    try {
      const res = await window.electronAPI?.checkProxy(raw)
      const latencyMs: number | null = res?.latencyMs ?? null
      if (res?.alive) {
        setProxies((prev) =>
          prev.map((p) => (p.raw === raw ? { ...p, status: 'alive' as const, latencyMs } : p)),
        )
        toast.success(`Прокси жив${latencyMs != null ? ` (${latencyMs} мс)` : ''}`)
      } else {
        setProxies((prev) =>
          prev.map((p) => (p.raw === raw ? { ...p, status: 'dead' as const, latencyMs: null, error: res?.error ?? null } : p)),
        )
        toast.error(`Прокси мёртв${res?.error ? ` — ${String(res.error).slice(0, 120)}` : ''}`)
      }
    } catch {
      toast.error('Не удалось проверить прокси')
    }
  }, [])

  const aliveCount = proxies.filter(p => p.status === 'alive').length
  const deadCount = proxies.filter(p => p.status === 'dead').length
  const unknownCount = proxies.filter(p => p.status === 'unknown').length
  const totalAccounts = proxies.reduce((sum, p) => sum + (p.accountCount || 0), 0)

  return (
    <div className="p-3 space-y-3 h-full flex flex-col bg-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Прокси-менеджер</h2>
          {checkedAt && (
            <span className="text-[10px] text-muted-foreground/40 hidden sm:inline">последняя проверка: {checkedAt}</span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={handleImportProxies}>
            <Upload className="h-3.5 w-3.5" /> Импорт
          </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              onClick={handleAssignToAccounts}
              disabled={isAssigning || proxies.length === 0 || accounts.length === 0}
              title="Раздать прокси из пула всем аккаунтам по кругу"
            >
              <Users2 className={cn('h-3.5 w-3.5', isAssigning && 'animate-pulse')} />
              {isAssigning ? 'Раздаю...' : 'Раздать аккаунтам'}
            </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={handleCheckAll} disabled={isChecking}>
            <Activity className={cn('h-3.5 w-3.5', isChecking && 'animate-spin')} />
            {isChecking ? 'Проверка...' : 'Проверить все'}
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
            <Server className="h-3 w-3" /> Всего
          </div>
          <div className="text-xl font-bold text-foreground/90 tabular-nums">{proxies.length}</div>
        </div>
        <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-2.5 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] text-green-400/80">
            <CheckCircle2 className="h-3 w-3" /> Живых
          </div>
          <div className="text-xl font-bold text-green-400 tabular-nums">{aliveCount}</div>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-2.5 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] text-red-400/80">
            <XCircle className="h-3 w-3" /> Мёртвых
          </div>
          <div className="text-xl font-bold text-red-400 tabular-nums">{deadCount}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/30 p-2.5 flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
            <Users className="h-3 w-3" /> Аккаунты
          </div>
          <div className="text-xl font-bold text-foreground/90 tabular-nums">{totalAccounts}</div>
        </div>
      </div>

      {/* Direct connection row */}
      <div className="rounded-xl border border-border/60 bg-muted/20 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Shield className="h-4 w-4 text-primary" />
          </div>
          <div>
            <span className="text-sm font-medium text-foreground/90">Прямое подключение</span>
            <div className="text-[10px] text-muted-foreground/50">Без прокси</div>
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground/40 px-2 py-0.5 rounded-full bg-muted/40">всегда</span>
      </div>

      {/* Proxies table */}
      <ScrollArea className="flex-1 scrollbar-thin">
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="h-9 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Прокси</TableHead>
                <TableHead className="h-9 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-20">Тип</TableHead>
                <TableHead className="h-9 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-20">Статус</TableHead>
                <TableHead className="h-9 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 w-16 text-center">Акк.</TableHead>
                <TableHead className="h-9 w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proxies.map((proxy, idx) => (
                <TableRow key={idx} className="border-border/30 hover:bg-foreground/[0.03]">
                  <TableCell className="text-[11px] font-mono py-2">{proxy.raw}</TableCell>
                  <TableCell className="py-2">
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-muted/60 border border-border/50">{proxy.type}</span>
                  </TableCell>
                  <TableCell className="py-2">
                    <div className="flex items-center gap-1.5">
                      {proxy.status === 'alive' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                      {proxy.status === 'dead' && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                      {proxy.status === 'unknown' && <div className="w-3 h-3 rounded-full border-2 border-muted-foreground/30" />}
                      <span className="text-[10px] text-muted-foreground/60 hidden lg:inline">
                        {proxy.status === 'alive' ? 'жив' : proxy.status === 'dead' ? 'мёртв' : 'н/д'}
                      </span>
                      {proxy.status === 'alive' && proxy.latencyMs != null && (
                        <span className="text-[9px] tabular-nums text-muted-foreground/50">
                          {proxy.latencyMs} мс
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-[11px] text-center tabular-nums text-muted-foreground/70 py-2">{proxy.accountCount || 0}</TableCell>
                  <TableCell className="py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 hover:bg-primary/10 hover:text-primary"
                      onClick={() => handleCheckOne(proxy.raw)}
                      title="Проверить"
                    >
                      <Activity className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {proxies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center">
                        <Globe className="h-6 w-6 opacity-40" />
                      </div>
                      <span className="text-xs text-muted-foreground/50">Нет загруженных прокси</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </ScrollArea>
    </div>
  )
}
