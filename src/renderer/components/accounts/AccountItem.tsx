"use client"

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Globe } from 'lucide-react'
import { useAccountStore } from '@/store/useAccountStore'
import type { Account, AccountStatus } from '@/lib/types'

interface AccountItemProps {
  account: Account
  isSelected: boolean
  onSelect: () => void
}

const STATUS_INDICATOR: Record<AccountStatus, { color: string; ring: string; label: string }> = {
  online: { color: 'bg-green-500', ring: 'ring-green-500/20', label: 'Подключен' },
  offline: { color: 'bg-slate-500', ring: 'ring-slate-500/10', label: 'Не подключен' },
  connecting: { color: 'bg-yellow-500 animate-pulse', ring: 'ring-yellow-500/20', label: 'Подключение...' },
  error: { color: 'bg-red-500', ring: 'ring-red-500/20', label: 'Ошибка' },
}

/**
 * Deterministic color from domain string for avatar variety.
 * Maps to a set of visually distinct gradients.
 */
function getAvatarColors(domain: string): string {
  const palette = [
    'from-violet-500 to-purple-600',
    'from-sky-500 to-blue-600',
    'from-emerald-500 to-teal-600',
    'from-amber-500 to-orange-600',
    'from-rose-500 to-pink-600',
    'from-cyan-500 to-blue-600',
    'from-indigo-500 to-violet-600',
    'from-lime-500 to-green-600',
  ]
  let hash = 0
  for (let i = 0; i < domain.length; i++) hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]
}

export default function AccountItem({ account, isSelected, onSelect }: AccountItemProps): React.JSX.Element {
  const indicator = STATUS_INDICATOR[account.status]
  const initials = account.email.charAt(0).toUpperCase()
  const avatarColors = getAvatarColors(account.domain)
  const { updateAccountStatus } = useAccountStore()

  const handleToggleConnect = async () => {
    if (account.status === 'online') {
      updateAccountStatus(account.id, 'offline')
      try {
        await window.electronAPI?.disconnectAccount(account.id)
        toast.success(`Отключен: ${account.email}`)
      } catch (e: any) {
        toast.error(`Ошибка отключения: ${e?.message}`)
      }
    } else {
      updateAccountStatus(account.id, 'connecting')
      try {
        const res = await window.electronAPI?.connectAccount(account.id)
        if (res?.success !== false) {
          toast.success(`Подключен: ${account.email}`)
        } else {
          updateAccountStatus(account.id, 'error', res?.error)
          toast.error(`Auth Error: ${res?.error || 'неверный пароль'}`)
        }
      } catch (e: any) {
        updateAccountStatus(account.id, 'error', e?.message)
        toast.error(`Ошибка подключения: ${e?.message}`)
      }
    }
  }

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(account.email)
    toast.success('Email скопирован')
  }

  const handleShowDetails = () => {
    toast.info(`Email: ${account.email}\nПрокси: ${account.proxy || 'прямое'}\nСтатус: ${indicator.label}`, { duration: 5000 })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={onSelect}
          className={cn(
            'flex items-center gap-2.5 px-2 py-1.5 mx-1 rounded-lg cursor-pointer transition-all duration-150 group',
            isSelected
              ? 'bg-primary/10 border border-primary/30 shadow-sm'
              : 'border border-transparent hover:bg-foreground/5',
          )}
        >
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="relative flex-shrink-0">
                  {/* Colored avatar with gradient */}
                  <div className={cn(
                    'w-7 h-7 rounded-lg bg-gradient-to-br flex items-center justify-center text-[11px] font-bold text-white shadow-sm transition-transform group-hover:scale-105',
                    avatarColors,
                  )}>
                    {initials}
                  </div>
                  {/* Status dot overlay */}
                  <div
                    className={cn(
                      'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ring-2',
                      indicator.color,
                      indicator.ring,
                    )}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs max-w-[260px] p-2">
                <p className="font-semibold">{account.email}</p>
                <p className={cn(
                  'mt-0.5',
                  account.status === 'online' && 'text-green-400',
                  account.status === 'error' && 'text-red-400',
                  account.status === 'connecting' && 'text-yellow-400',
                  account.status === 'offline' && 'text-muted-foreground',
                )}>{indicator.label}</p>
                {account.error && <p className="text-red-400 text-[10px] mt-0.5 truncate">{account.error}</p>}
                {account.proxy && <p className="text-muted-foreground text-[10px] mt-0.5">Прокси: {account.proxy}</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Email + domain */}
          <div className="flex-1 min-w-0">
            <div className={cn(
              'text-xs truncate leading-tight',
              account.status === 'online' ? 'text-foreground font-medium' : 'text-foreground/70',
            )}>
              {account.email}
            </div>
            <div className="text-[9px] text-muted-foreground/60 leading-tight">{account.domain}</div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={handleToggleConnect}>
          {account.status === 'online' ? 'Отключить' : 'Подключить'}
        </ContextMenuItem>
        {/* Change proxy: pick from the loaded pool (TechTask §4.2) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ContextMenuItem onSelect={(e) => e.preventDefault()}>
              <Globe className="mr-2 h-3.5 w-3.5" />
              Сменить прокси
            </ContextMenuItem>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" className="max-h-64 overflow-y-auto">
            <ContextMenuItem
              onSelect={async () => {
                const res = await window.electronAPI?.assignProxy(account.id, null)
                if (res?.success) toast.success(`Прямое подключение: ${account.email}`)
                else toast.error(res?.error || `Не удалось назначить прокси ${account.email}`)
              }}
            >
              Прямое подключение (без прокси)
            </ContextMenuItem>
            <DropdownMenuSeparator />
            <PoolProxyItems accountId={account.id} email={account.email} />
          </DropdownMenuContent>
        </DropdownMenu>
        <ContextMenuItem onClick={handleCopyEmail}>Копировать email</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleShowDetails}>Показать детали</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * Renders the proxy pool (persisted in electron-store via getSettings)
 * as selectable items; assigning calls accounts:assign-proxy main-side.
 */
function PoolProxyItems({ accountId, email }: { accountId: string; email: string }): React.JSX.Element {
  const [proxies, setProxies] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const settings = await window.electronAPI?.getSettings()
        if (!cancelled && Array.isArray(settings?.proxies)) {
          setProxies(settings.proxies as string[])
        }
      } catch {
        // pool simply stays empty
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (proxies.length === 0) {
    return <div className="px-2 py-1.5 text-xs text-muted-foreground">Пул прокси пуст</div>
  }

  return (
    <>
      {proxies.map((raw) => (
        <ContextMenuItem
          key={raw}
          onSelect={async () => {
            const res = await window.electronAPI?.assignProxy(accountId, raw)
            if (res?.success) {
              toast.success(`Прокси назначен для ${email}`)
            } else {
              toast.error(res?.error || `Не удалось назначить прокси ${email}`)
            }
          }}
        >
          <span className="font-mono text-xs truncate max-w-[220px]">{raw}</span>
        </ContextMenuItem>
      ))}
    </>
  )
}
