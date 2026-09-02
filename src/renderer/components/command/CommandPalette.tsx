"use client"

import { useEffect } from 'react'
import { toast } from 'sonner'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'
import { Users, Settings2, Globe, Plug, PlugZap, Sun, Moon, Mail } from 'lucide-react'
import { useAccountStore, type Account } from '@/store/useAccountStore'
import { useSettingsStore } from '@/store/useSettingsStore'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectAccount: (account: Account) => void
  onSelectTab: (tab: 'accounts' | 'config' | 'proxy') => void
}

/**
 * Ctrl+K / Cmd+K command palette — quick jump to accounts, tabs and bulk actions.
 */
export default function CommandPalette({
  open,
  onOpenChange,
  onSelectAccount,
  onSelectTab,
}: CommandPaletteProps): React.JSX.Element {
  const accounts = useAccountStore((s) => s.accounts)
  const toggleTheme = useSettingsStore((s) => s.toggleTheme)
  const theme = useSettingsStore((s) => s.theme)

  // Global Ctrl+K / Cmd+K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const run = (fn: () => void): void => {
    fn()
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Поиск аккаунта или команды..." />
      <CommandList>
        <CommandEmpty>Ничего не найдено.</CommandEmpty>

        <CommandGroup heading="Действия">
          <CommandItem onSelect={() => run(() => { window.electronAPI?.connectAll(); toast.info('Подключение всех аккаунтов...') })}>
            <PlugZap className="mr-2 h-4 w-4" /> Подключить все
          </CommandItem>
          <CommandItem onSelect={() => run(() => { window.electronAPI?.disconnectAll(); toast.info('Отключение всех аккаунтов...') })}>
            <Plug className="mr-2 h-4 w-4" /> Отключить все
          </CommandItem>
          <CommandItem onSelect={() => run(toggleTheme)}>
            {theme === 'dark' ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            Переключить тему
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Разделы">
          <CommandItem onSelect={() => run(() => onSelectTab('accounts'))}>
            <Users className="mr-2 h-4 w-4" /> Аккаунты
          </CommandItem>
          <CommandItem onSelect={() => run(() => onSelectTab('config'))}>
            <Settings2 className="mr-2 h-4 w-4" /> Конфигурация
          </CommandItem>
          <CommandItem onSelect={() => run(() => onSelectTab('proxy'))}>
            <Globe className="mr-2 h-4 w-4" /> Прокси-менеджер
          </CommandItem>
        </CommandGroup>

        {accounts.length > 0 && (
          <CommandGroup heading="Аккаунты">
            {accounts.map((acc, i) => (
              <CommandItem
                key={acc.id}
                // Include email in value so fuzzy search matches it.
                value={`account ${acc.email} ${acc.domain}`}
                onSelect={() => run(() => { onSelectTab('accounts'); onSelectAccount(acc) })}
              >
                <Mail className="mr-2 h-4 w-4" />
                <span className="truncate">{acc.email}</span>
                {i < 9 && <CommandShortcut>Alt+{i + 1}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
