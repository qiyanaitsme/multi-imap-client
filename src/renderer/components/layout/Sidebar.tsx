"use client"

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Search, Plug, Unplug, RefreshCw, Wifi, WifiOff, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import AccountItem from '../accounts/AccountItem'
import { useAccountStore } from '@/store/useAccountStore'
import type { Account, AccountStatus } from '@/lib/types'

interface SidebarProps {
  selectedAccount: Account | null
  onAccountSelect: (account: Account) => void
}

export default function Sidebar({ selectedAccount, onAccountSelect }: SidebarProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'error'>('all')

  // Narrow selectors: re-render only when these slices actually change
  const accounts = useAccountStore((s) => s.accounts)
  const updateAccountStatus = useAccountStore((s) => s.updateAccountStatus)

  useEffect(() => {
    if (!window.electronAPI?.on) return
    const unsub = window.electronAPI.on('accounts:status-changed', (data: any) => {
      if (data?.accountId && data?.status) {
        updateAccountStatus(data.accountId, data.status as AccountStatus, data.error)
      }
    })
    return () => unsub?.()
  }, [updateAccountStatus])

  const handleConnectAll = useCallback(async () => {
    toast.info('Подключение всех аккаунтов...')
    try {
      await window.electronAPI?.connectAll()
      toast.success('Массовое подключение выполнено')
    } catch (e: any) {
      toast.error(`Ошибка: ${e?.message || 'unknown'}`)
    }
  }, [])

  const handleDisconnectAll = useCallback(async () => {
    toast.info('Отключение всех аккаунтов...')
    try {
      await window.electronAPI?.disconnectAll()
      toast.success('Все аккаунты отключены')
    } catch (e: any) {
      toast.error(`Ошибка: ${e?.message || 'unknown'}`)
    }
  }, [])

  const handleReconnectAll = useCallback(async () => {
    toast.info('Переподключение всех аккаунтов...')
    try {
      await window.electronAPI?.disconnectAll()
      await new Promise((r) => setTimeout(r, 1000))
      await window.electronAPI?.connectAll()
      toast.success('Переподключение выполнено')
    } catch (e: any) {
      toast.error(`Ошибка: ${e?.message || 'unknown'}`)
    }
  }, [])

  const filteredAccounts = accounts.filter((a) => {
    if (search) {
      const lower = search.toLowerCase()
      if (!a.email.toLowerCase().includes(lower) && !a.domain.toLowerCase().includes(lower)) return false
    }
    if (statusFilter !== 'all' && a.status !== statusFilter) return false
    return true
  })

  const grouped = filteredAccounts.reduce<Record<string, Account[]>>((acc, a) => {
    if (!acc[a.domain]) acc[a.domain] = []
    acc[a.domain].push(a)
    return acc
  }, {})

  const onlineCount = accounts.filter((a) => a.status === 'online').length
  const errorCount = accounts.filter((a) => a.status === 'error').length
  const totalCount = accounts.length
  const offlineCount = totalCount - onlineCount - errorCount - accounts.filter(a => a.status === 'connecting').length

  return (
    <div className="flex flex-col h-full bg-panel">
      {/* Search + bulk actions */}
      <div className="p-2.5 space-y-2.5 border-b border-border/60">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input
            placeholder="Поиск аккаунтов..."
            className="h-8 pl-8 text-xs bg-muted/50 border-border/50"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 flex-1 text-[11px] gap-1" onClick={handleConnectAll}>
                  <Plug className="h-3 w-3 text-green-500" /> Подключить
                </Button>
              </TooltipTrigger>
              <TooltipContent>Подключить все</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 flex-1 text-[11px] gap-1" onClick={handleDisconnectAll}>
                  <Unplug className="h-3 w-3 text-orange-500" /> Отключить
                </Button>
              </TooltipTrigger>
              <TooltipContent>Отключить все</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={handleReconnectAll}>
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Переподключить все</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Status filter chips */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setStatusFilter('all')}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 h-5 rounded-full text-[10px] font-medium transition-colors border',
              statusFilter === 'all'
                ? 'bg-primary/15 border-primary/40 text-primary'
                : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground',
            )}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            {totalCount} всех
          </button>
          <button
            onClick={() => setStatusFilter('online')}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 h-5 rounded-full text-[10px] font-medium transition-colors border',
              statusFilter === 'online'
                ? 'bg-green-500/15 border-green-500/40 text-green-400'
                : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground',
            )}
          >
            <Wifi className="h-2.5 w-2.5" />
            {onlineCount}
          </button>
          {offlineCount > 0 && (
            <button
              onClick={() => setStatusFilter('offline')}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 h-5 rounded-full text-[10px] font-medium transition-colors border',
                statusFilter === 'offline'
                  ? 'bg-muted/60 border-foreground/30 text-foreground'
                  : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground',
              )}
            >
              <WifiOff className="h-2.5 w-2.5" />
              {offlineCount}
            </button>
          )}
          {errorCount > 0 && (
            <button
              onClick={() => setStatusFilter('error')}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 h-5 rounded-full text-[10px] font-medium transition-colors border',
                statusFilter === 'error'
                  ? 'bg-red-500/15 border-red-500/40 text-red-400'
                  : 'bg-muted/40 border-border/50 text-muted-foreground hover:text-foreground',
              )}
            >
              <AlertCircle className="h-2.5 w-2.5" />
              {errorCount}
            </button>
          )}
        </div>
      </div>

      {/* Account list */}
      <ScrollArea className="flex-1 scrollbar-thin">
        <div className="p-1.5">
          {Object.entries(grouped).map(([domain, accs]) => {
            const domainOnline = accs.filter(a => a.status === 'online').length
            return (
              <div key={domain} className="mb-2">
                {/* Sticky domain header */}
                <div className="sticky top-0 z-10 flex items-center justify-between px-2 py-1 text-[10px] font-bold text-muted-foreground/70 uppercase tracking-wider bg-card/40 backdrop-blur-sm border-b border-border/30">
                  <span className="truncate">{domain}</span>
                  <span className={cn(
                    'tabular-nums font-semibold text-[9px] px-1.5 py-0.5 rounded-full',
                    domainOnline > 0 ? 'text-green-400/80 bg-green-500/10' : 'text-muted-foreground/50',
                  )}>
                    {domainOnline}/{accs.length}
                  </span>
                </div>
                {accs.map((account) => (
                  <AccountItem
                    key={account.id}
                    account={account}
                    isSelected={selectedAccount?.id === account.id}
                    onSelect={() => onAccountSelect(account)}
                  />
                ))}
              </div>
            )
          })}

          {filteredAccounts.length === 0 && (
            <div className="flex flex-col items-center justify-center text-xs text-muted-foreground/50 py-12 gap-3">
              <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center">
                <Search className="h-5 w-5 opacity-40" />
              </div>
              <p className="text-center max-w-[80%]">
                {accounts.length === 0
                  ? 'Нет загруженных аккаунтов. Откройте вкладку «Конфиг» для импорта.'
                  : 'Нет аккаунтов по фильтру'}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
