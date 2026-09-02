"use client"

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSettingsStore } from '@/store/useSettingsStore'

interface SettingsSheetProps {
  children: React.ReactNode
}

const PAGE_SIZES = [30, 50, 100] as const
const MAX_CONNECTIONS = [10, 25, 50, 100, 200] as const
const TIMEOUTS = [10, 20, 30, 60, 120] as const
const AUTO_DISCONNECT = [0, 1, 5, 10, 30, 60] as const

/**
 * Settings panel (Sheet). Replaces the previously hard-coded ImapManager
 * parameters with user-configurable, persisted values.
 */
export default function SettingsSheet({ children }: SettingsSheetProps): React.JSX.Element {
  const {
    compactMode,
    pageSize,
    maxConnections,
    connectionTimeoutSeconds,
    autoDisconnectMinutes,
    theme,
    setCompactMode,
    setPageSize,
    setMaxConnections,
    setConnectionTimeoutSeconds,
    setAutoDisconnectMinutes,
    setTheme,
  } = useSettingsStore()

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="w-[360px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle>Настройки</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Interface */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Интерфейс
            </h3>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Тема оформления</Label>
              <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark')}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Тёмная</SelectItem>
                  <SelectItem value="light">Светлая</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="compact" className="text-sm">Компактный режим сайдбара</Label>
              <Switch id="compact" checked={compactMode} onCheckedChange={setCompactMode} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Писем на странице</Label>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v) as 30 | 50 | 100)}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          <Separator />

          {/* Connections */}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Подключения
            </h3>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Лимит одновременных</Label>
              <Select value={String(maxConnections)} onValueChange={(v) => setMaxConnections(Number(v))}>
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MAX_CONNECTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Таймаут подключения</Label>
              <Select
                value={String(connectionTimeoutSeconds)}
                onValueChange={(v) => setConnectionTimeoutSeconds(Number(v))}
              >
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIMEOUTS.map((t) => (
                    <SelectItem key={t} value={String(t)}>{t} сек</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Автоотключение неактивных</Label>
              <Select
                value={String(autoDisconnectMinutes)}
                onValueChange={(v) => setAutoDisconnectMinutes(Number(v))}
              >
                <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AUTO_DISCONNECT.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 0 ? 'Никогда' : `${m} мин`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Изменения лимитов и таймаутов применяются к новым подключениям.
            Настройки сохраняются автоматически.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
