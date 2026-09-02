"use client"

import { useEffect, useState } from 'react'
import { Users, Wifi, AlertCircle, Globe, Loader2, Mail } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAccountStore } from '@/store/useAccountStore'
import type { AccountStatus } from '@/lib/types'

interface StatCardProps {
  title: string
  value: number | string
  icon: React.ReactNode
  accent: string
}

/** Compact KPI tile used on the dashboard. */
function StatCard({ title, value, icon, accent }: StatCardProps): React.JSX.Element {
  return (
    <Card className="border-border/50">
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</p>
            <p className={`text-2xl font-bold tabular-nums ${accent}`}>{value}</p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-muted/60 flex items-center justify-center">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Dashboard (IDEAS #18): at-a-glance stats.
 * Data sources already available client-side: account store (live) and
 * electron-store settings via IPC (proxy pool size).
 */
export default function Dashboard(): React.JSX.Element {
  // Narrow zustand selectors — re-render only on relevant slices
  const accounts = useAccountStore((s) => s.accounts)
  const onlineCount = useAccountStore((s) => s.getOnlineCount())
  const errorCount = useAccountStore((s) => s.getErrorCount())

  const [proxyCount, setProxyCount] = useState(0)
  const [connecting, setConnecting] = useState(0)

  useEffect(() => {
    setConnecting(accounts.filter((a) => a.status === ('connecting' as AccountStatus)).length)
  }, [accounts])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const settings = await window.electronAPI?.getSettings()
        if (!cancelled && Array.isArray(settings?.proxies)) {
          setProxyCount(settings.proxies.length as number)
        }
      } catch {
        // pool count simply stays 0
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Top domains by account count (max 5)
  const domainCounts = new Map<string, number>()
  for (const a of accounts) {
    domainCounts.set(a.domain, (domainCounts.get(a.domain) ?? 0) + 1)
  }
  const topDomains = Array.from(domainCounts.entries())
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5)

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2.5">
        <StatCard
          title="Аккаунтов"
          value={accounts.length}
          icon={<Users className="h-4 w-4 text-sky-400" />}
          accent="text-sky-400"
        />
        <StatCard
          title="Онлайн"
          value={onlineCount}
          icon={<Wifi className="h-4 w-4 text-emerald-400" />}
          accent="text-emerald-400"
        />
        <StatCard
          title="Подключается"
          value={connecting}
          icon={<Loader2 className="h-4 w-4 text-yellow-400" />}
          accent="text-yellow-400"
        />
        <StatCard
          title="Ошибок"
          value={errorCount}
          icon={<AlertCircle className="h-4 w-4 text-red-400" />}
          accent="text-red-400"
        />
      </div>

      {/* Proxy pool */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-violet-400" />
            Пул прокси
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <p className="text-xl font-bold tabular-nums text-violet-400">{proxyCount}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">прокси загружено в настройки</p>
        </CardContent>
      </Card>

      {/* Top domains */}
      <Card className="border-border/50">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-xs flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5 text-primary" />
            Топ доменов
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0 space-y-1.5">
          {topDomains.length === 0 ? (
            <p className="text-xs text-muted-foreground">Нет импортированных аккаунтов</p>
          ) : (
            topDomains.map(([domain, count]) => (
              <div key={domain} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground flex-1 truncate font-mono">{domain}</span>
                <div className="flex-1 max-w-[120px] h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 to-blue-600"
                    style={{ width: `${Math.round((count / accounts.length) * 100)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold tabular-nums w-6 text-right">{count}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
