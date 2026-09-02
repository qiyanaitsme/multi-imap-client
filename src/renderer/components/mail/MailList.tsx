"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Paperclip, ChevronLeft, ChevronRight, Inbox, Mail, Star, Search, X } from 'lucide-react'
import { cn, hashGradient, getInitials } from '@/lib/utils'
import { useVirtualList } from '@/hooks/useVirtualList'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { Account, MailMessage } from '@/lib/types'

// Fixed row height used by the virtualizer (must match the rendered item height).
const ITEM_HEIGHT = 64
// Only virtualize beyond this many rows — small lists render normally for smoothness.
const VIRTUALIZE_THRESHOLD = 50

/**
 * Per-account mail-list context (TechTask §4.8): folder, page, search and
 * scroll position survive switching accounts. Keyed by account id; entries
 * are cheap (plain objects) and bounded in practice by the account count.
 */
interface AccountMailContext {
  folder: string | null
  page: number
  searchInput: string
  scrollTop: number
}
const mailContextCache = new Map<string, AccountMailContext>()

function loadMailContext(accountId: string): AccountMailContext {
  return mailContextCache.get(accountId) ?? { folder: null, page: 1, searchInput: '', scrollTop: 0 }
}

function saveMailContext(accountId: string, ctx: AccountMailContext): void {
  mailContextCache.set(accountId, ctx)
}

interface MailListProps {
  account: Account | null
  selectedMailId: string | null
  onMailSelect: (mailId: string) => void
}

const PAGE_SIZES = [30, 50, 100]


/**
 * Split text around case-insensitive matches of `query` and wrap them
 * in <mark>. Pure element output — no dangerouslySetInnerHTML.
 */
function Highlight({ text, query }: { text: string; query: string }): React.JSX.Element {
  if (!query) return <>{text}</>
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const parts: React.JSX.Element[] = []
  let pos = 0
  let idx = lower.indexOf(q)
  let key = 0
  while (idx !== -1) {
    if (idx > pos) parts.push(<span key={key++}>{text.slice(pos, idx)}</span>)
    parts.push(
      <mark key={key++} className="bg-amber-400/30 text-foreground rounded-sm px-0.5">
        {text.slice(idx, idx + q.length)}
      </mark>,
    )
    pos = idx + q.length
    idx = lower.indexOf(q, pos)
  }
  if (pos < text.length) parts.push(<span key={key++}>{text.slice(pos)}</span>)
  return <>{parts}</>
}
export default function MailList({ account, selectedMailId, onMailSelect }: MailListProps): React.JSX.Element {
  const [folders, setFolders] = useState<string[]>([])
  const [currentFolder, setCurrentFolder] = useState<string>('INBOX')
  const [messages, setMessages] = useState<MailMessage[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const settingsPageSize = useSettingsStore((s) => s.pageSize)
  const [pageSize, setPageSize] = useState(settingsPageSize)

  // Search (TechTask §4.9): debounced by 300ms before hitting IMAP SEARCH.
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Follow the global default page size when the user changes it in Settings.
  useEffect(() => {
    setPageSize(settingsPageSize)
    setPage(1)
  }, [settingsPageSize])

  // Debounce search input -> query (300ms per TechTask §4.9)
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)

  useEffect(() => {
    if (!account) {
      setFolders([])
      setMessages([])
      setTotal(0)
      return
    }
    // Restore this account's saved context (folder/page/search) — TechTask §4.8
    const ctx = loadMailContext(account.id)
    setCurrentFolder(ctx.folder ?? 'INBOX')
    setPage(ctx.page)
    setSearchInput(ctx.searchInput)
    setSearchQuery(ctx.searchInput.trim())
    let cancelled = false
    const loadFolders = async () => {
      setLoadingFolders(true)
      try {
        const res = await window.electronAPI?.fetchFolders(account.id)
        if (cancelled) return
        if (res?.success) {
          const flat: string[] = []
          const walk = (nodes: any[]) => {
            for (const n of nodes) {
              flat.push(n.fullPath || n.path || n.name)
              if (n.children?.length) walk(n.children)
            }
          }
          walk(res.data || [])
          setFolders(flat)
          // Only pick a default when no folder was restored for this account
          setCurrentFolder((prev) => (prev && flat.includes(prev) ? prev : flat.includes('INBOX') ? 'INBOX' : flat[0] ?? prev))
        } else {
          toast.error('Не удалось получить папки. Проверьте подключение к аккаунту.')
        }
      } catch (e: any) {
        if (!cancelled) toast.error(`Ошибка загрузки папок: ${e?.message}`)
      } finally {
        if (!cancelled) setLoadingFolders(false)
      }
    }
    loadFolders()
    return () => {
      cancelled = true
      // Persist context so returning to this account restores it
      saveMailContext(account.id, {
        folder: currentFolder,
        page,
        searchInput,
        scrollTop: 0,
      })
    }
  }, [account, currentFolder, page, searchInput])

  const fetchMails = useCallback(async () => {
    if (!account || !currentFolder) return
    setLoadingMessages(true)
    try {
      const res = await window.electronAPI?.fetchMails(account.id, currentFolder, { page, pageSize, searchQuery: searchQuery || undefined })
      if (res?.success) {
        setMessages(res.messages || [])
        setTotal(res.total || 0)
      } else {
        toast.error(res?.error || 'Не удалось загрузить письма')
        setMessages([])
      }
    } catch (e: any) {
      toast.error(`Ошибка загрузки писем: ${e?.message}`)
      setMessages([])
    } finally {
      setLoadingMessages(false)
    }
  }, [account, currentFolder, page, pageSize, searchQuery])

  useEffect(() => { fetchMails() }, [fetchMails])

  // Keyboard navigation: ↑/↓ move selection, Enter opens. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (messages.length === 0) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return

      e.preventDefault()
      const curIdx = messages.findIndex((m) => m.uid === selectedMailId)
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const nextIdx =
        curIdx === -1
          ? 0
          : Math.min(messages.length - 1, Math.max(0, curIdx + dir))
      onMailSelect(messages[nextIdx].uid)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [messages, selectedMailId, onMailSelect])

  const unreadCount = useMemo(() => messages.filter((m) => !m.isRead).length, [messages])

  // Push unread counter of the current folder to the tray tooltip (IDEAS #17)
  useEffect(() => {
    window.electronAPI?.updateTrayBadge?.(unreadCount)
  }, [unreadCount])
  const totalPages = Math.ceil(total / pageSize) || 1

  const formatDate = (d: Date | string): string => {
    const date = new Date(d)
    if (isNaN(date.getTime())) return '—'
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    if (isToday) return date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000)
    if (diffDays < 7) return date.toLocaleDateString('ru', { weekday: 'short' })
    return date.toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit' })
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Render a single message row — shared by the plain and virtualized paths.
  const renderRow = (mail: MailMessage): React.JSX.Element => {
    const isSelected = selectedMailId === mail.uid
    const senderKey = mail.fromEmail || mail.fromName || ''
    const initials = getInitials(mail.fromName, mail.fromEmail)
    const colors = hashGradient(senderKey)
    return (
      <div
        key={mail.uid}
        onClick={() => onMailSelect(mail.uid)}
        style={{ height: ITEM_HEIGHT }}
        className={cn(
          'flex gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-150 group overflow-hidden',
          isSelected
            ? 'bg-primary/10 border border-primary/30 shadow-sm'
            : 'border border-transparent hover:bg-foreground/5',
          !mail.isRead && !isSelected && 'bg-foreground/[0.03]',
        )}
      >
        {/* Sender avatar */}
        <div className={cn(
          'w-9 h-9 rounded-lg bg-gradient-to-br flex items-center justify-center text-xs font-bold text-white shadow-sm flex-shrink-0 transition-transform group-hover:scale-105',
          colors,
        )}>
          {initials}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {!mail.isRead && (
              <div className="w-1 h-3.5 rounded-full bg-primary flex-shrink-0" />
            )}
            <span className={cn(
              'text-sm truncate leading-tight flex-1',
              mail.isRead ? 'text-foreground/80 font-normal' : 'text-foreground font-semibold',
            )}>
              <Highlight text={mail.subject || '(Без темы)'} query={searchQuery} />
            </span>
            {mail.isFlagged && (
              <Star className="h-3 w-3 text-amber-400 fill-amber-400 flex-shrink-0" />
            )}
            {mail.hasAttachments && (
              <Paperclip className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn(
              'text-xs truncate',
              mail.isRead ? 'text-muted-foreground/60' : 'text-muted-foreground font-medium',
            )}>
              <Highlight text={mail.fromName} query={searchQuery} />
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] text-muted-foreground/50">{formatDate(mail.date)}</span>
            {mail.size > 0 && (
              <span className="text-[9px] text-muted-foreground/40">{formatSize(mail.size)}</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!account) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-sm text-muted-foreground gap-3 bg-panel">
        <div className="w-14 h-14 rounded-2xl bg-muted/30 flex items-center justify-center">
          <Inbox className="h-7 w-7 opacity-40" />
        </div>
        <p className="text-muted-foreground/70">Выберите аккаунт для просмотра писем</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-panel">
      {/* Folder selector + unread badge */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/60">
        <Select value={currentFolder} onValueChange={(v) => { setCurrentFolder(v); setPage(1) }}>
          <SelectTrigger className="h-8 text-xs flex-1 bg-muted/50 border-border/50">
            <SelectValue placeholder="Папка" />
          </SelectTrigger>
          <SelectContent>
            {loadingFolders ? (
              <SelectItem value="loading">Загрузка папок...</SelectItem>
            ) : (
              folders.map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {unreadCount > 0 && (
          <div className="flex items-center gap-1 px-2 h-8 rounded-md bg-primary/15 border border-primary/30">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-[10px] font-bold text-primary tabular-nums">{unreadCount}</span>
          </div>
        )}
      </div>

      {/* Search box (debounced, TechTask §4.9) */}
      <div className="relative px-3 py-2 border-b border-border/60">
        <Search className="absolute left-5.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
        <Input
          placeholder="Поиск по теме, отправителю, тексту..."
          className="h-8 pl-8 pr-8 text-xs bg-muted/50 border-border/50"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {searchInput && (
          <button
            onClick={() => setSearchInput('')}
            className="absolute right-5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-muted-foreground/20 hover:bg-muted-foreground/40 flex items-center justify-center transition-colors"
            title="Очистить"
          >
            <X className="h-2.5 w-2.5 text-background" />
          </button>
        )}
      </div>
      {/* Account email header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2 min-w-0">
          <Mail className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
          <span className="text-xs font-medium truncate text-foreground/80">{account.email}</span>
        </div>
        <Badge variant="outline" className="text-[10px] tabular-nums flex-shrink-0">{total}</Badge>
      </div>

      {/* Messages */}
      {loadingMessages ? (
        <ScrollArea className="flex-1 scrollbar-thin">
          <div className="p-2 space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-2.5 p-2.5">
                <Skeleton className="h-9 w-9 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                  <Skeleton className="h-2 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-sm text-muted-foreground gap-3 py-16">
          <div className="w-12 h-12 rounded-full bg-muted/30 flex items-center justify-center">
            <Inbox className="h-6 w-6 opacity-40" />
          </div>
          <p className="text-muted-foreground/60">В папке «{currentFolder}» нет писем</p>
        </div>
      ) : messages.length > VIRTUALIZE_THRESHOLD ? (
        // Virtualized path — only visible rows are in the DOM.
        <VirtualMessages
          messages={messages}
          renderRow={renderRow}
          resetKey={`${account.id}:${currentFolder}:${page}`}
        />
      ) : (
        // Plain path for small lists (smoother, no virtualization overhead).
        <ScrollArea className="flex-1 scrollbar-thin">
          <div className="p-1.5">{messages.map(renderRow)}</div>
        </ScrollArea>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border/60 bg-muted/20">
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {page} / {totalPages}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v) as 30 | 50 | 100); setPage(1) }}>
            <SelectTrigger className="h-6 w-14 text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((s) => (
                <SelectItem key={s} value={String(s)}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

interface VirtualMessagesProps {
  messages: MailMessage[]
  renderRow: (mail: MailMessage) => React.JSX.Element
  /** Changing this key scrolls the list back to the top (new folder/page). */
  resetKey: string
}

/**
 * Virtualized message list — renders only the rows within the viewport window.
 * Uses a native scroll container (not shadcn ScrollArea) so we can read scrollTop.
 */
function VirtualMessages({ messages, renderRow, resetKey }: VirtualMessagesProps): React.JSX.Element {
  const { containerRef, totalHeight, startIndex, endIndex, offsetY } = useVirtualList({
    itemCount: messages.length,
    itemHeight: ITEM_HEIGHT,
  })

  // Scroll back to top when the underlying dataset changes (folder/page switch).
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0
  }, [resetKey, containerRef])

  const visible = messages.slice(startIndex, endIndex)

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto scrollbar-thin">
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)`, padding: '0 6px' }}>
          {visible.map(renderRow)}
        </div>
      </div>
    </div>
  )
}
