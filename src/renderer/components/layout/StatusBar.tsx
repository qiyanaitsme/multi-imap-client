"use client"

import { useEffect, useState } from 'react'
import { useAccountStore } from '@/store/useAccountStore'
import { cn } from '@/lib/utils'

export default function StatusBar(): React.JSX.Element {
  // Narrow selectors: subscribe only to the derived values rendered here
  const onlineCount = useAccountStore((s) => s.getOnlineCount())
  const errorCount = useAccountStore((s) => s.getErrorCount())
  const totalAccounts = useAccountStore((s) => s.accounts.length)
  const [proxyCount, setProxyCount] = useState(0)

  // Load proxy count from settings
  useEffect(() => {
    const loadProxies = async () => {
      try {
        const settings = await window.electronAPI?.getSettings()
        if (settings?.proxies && Array.isArray(settings.proxies)) {
          setProxyCount(settings.proxies.length)
        }
      } catch {
        // ignore
      }
    }
    loadProxies()
    // Refresh when accounts change (proxy count may change after import)
    const interval = setInterval(() => {
      loadProxies()
    }, 5000)
    return () => clearInterval(interval)
  }, [totalAccounts])

  const connecting = useAccountStore(
    (s) => s.accounts.filter((a) => a.status === 'connecting').length,
)

  return (
    <div className="h-6 flex items-center justify-between px-3 bg-muted/30 border-t border-border/60 text-[10px] text-muted-foreground select-none">
      <div className="flex items-center gap-3.5">
        {onlineCount > 0 ? (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="font-medium text-green-400/80 tabular-nums">{onlineCount}</span>
            <span>подключено</span>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
            <span>нет подключений</span>
          </span>
        )}

        {totalAccounts > 0 && (
          <span className="opacity-50">
            из <span className="tabular-nums">{totalAccounts}</span> аккаунтов
          </span>
        )}

        {connecting > 0 && (
          <span className="flex items-center gap-1 text-yellow-500/80">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
            <span className="tabular-nums">{connecting}</span>
            <span>подключается</span>
          </span>
        )}

        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-red-400/80">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            <span className="tabular-nums">{errorCount}</span>
            <span>ошибок</span>
          </span>
        )}

        {proxyCount > 0 && (
          <span className="opacity-50">
            <span className="tabular-nums">{proxyCount}</span> прокси
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="opacity-30">v1.0.0</span>
      </div>
    </div>
  )
}
