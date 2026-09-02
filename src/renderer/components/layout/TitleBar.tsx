"use client"

import { useState } from 'react'
import { Minus, Crown, Square, X, Settings, Search, Mail, Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccountStore } from '@/store/useAccountStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useUiStore } from '@/store/useUiStore'
import SettingsSheet from '@/components/settings/SettingsSheet'

interface TitleBarProps {
  className?: string
}

/** Creator profile — opened via main-process shell whitelist (https only). */
const CREATOR_PROFILE_URL = 'https://lolz.team/kqlol/'

export default function TitleBar({ className }: TitleBarProps): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  // Narrow selectors: subscribe only to what this component renders
  const online = useAccountStore((s) => s.getOnlineCount())
  const total = useAccountStore((s) => s.accounts.length)
  const theme = useSettingsStore((s) => s.theme)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)
  const toggleCommand = useUiStore((s) => s.toggleCommand)

  const handleMinimize = () => window.electronAPI?.minimize()
  const handleMaximize = () => {
    window.electronAPI?.maximize()
    setIsMaximized(!isMaximized)
  }
  const handleClose = () => window.electronAPI?.close()

  return (
    <div
      className={`h-9 flex items-center justify-between bg-muted/50 glass border-b border-border select-none ${className ?? ''}`}
    >
      {/* Left side: app icon + title — DRAG area */}
      <div
        className="flex items-center gap-2.5 pl-3 flex-1 h-full"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Mail className="h-3 w-3 text-white" />
        </div>
        <span className="text-xs font-semibold text-foreground/90">Multi IMAP Client</span>
      </div>

      {/* Center: search — NO DRAG */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="Командная палитра (Ctrl+K)"
          onClick={toggleCommand}
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Right side: connection status + settings + window controls — NO DRAG */}
      <div className="flex items-center gap-2 flex-1 justify-end h-full pr-1">
        {/* Live connection indicator */}
        <div className="flex items-center gap-1.5 px-2 h-7 rounded-md bg-muted/50 border border-border/50">
          <div className={`w-2 h-2 rounded-full ${online > 0 ? 'bg-green-500 shadow-sm shadow-green-500/50' : 'bg-muted-foreground/40'}`} />
          <span className="text-[10px] text-muted-foreground font-medium tabular-nums">
            {online}/{total}
          </span>
        </div>

          {/* Creator credit */}
          <button
            onClick={() => window.electronAPI?.openExternal(CREATOR_PROFILE_URL)}
            title="Создатель — kqlol"
            className="h-7 px-2 inline-flex items-center gap-1 rounded-md bg-gradient-to-r from-violet-500/15 to-fuchsia-500/15 border border-violet-500/30 text-[10px] font-bold tracking-wider text-violet-400/90 hover:from-violet-500/30 hover:to-fuchsia-500/30 hover:text-violet-300 transition-all"
          >
            <Crown className="h-3 w-3" />
            СОЗДАТЕЛЬ
          </button>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>

        <SettingsSheet>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Настройки"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </SettingsSheet>

        <div className="flex -mr-1">
          <button
            onClick={handleMinimize}
            className="h-9 w-10 inline-flex items-center justify-center hover:bg-foreground/10 transition-colors"
            title="Свернуть"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className="h-9 w-10 inline-flex items-center justify-center hover:bg-foreground/10 transition-colors"
            title="Развернуть"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleClose}
            className="h-9 w-10 inline-flex items-center justify-center hover:bg-red-500/80 hover:text-white transition-colors"
            title="Закрыть"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
