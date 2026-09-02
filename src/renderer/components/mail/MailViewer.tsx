"use client"

import { useState, useEffect, useCallback } from 'react'
import DOMPurify from 'dompurify'
import { toast } from 'sonner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Mail, Paperclip, Download, Copy, Check, Code2, FileText, Image as ImageIcon } from 'lucide-react'
import { cn, hashGradient, getInitials, formatSize } from '@/lib/utils'
import type { Account, MailContent } from '@/lib/types'
import SandboxedHtml from './SandboxedHtml'

interface MailViewerProps {
  account: Account | null
  mailId: string | null
}



export default function MailViewer({ account, mailId }: MailViewerProps): React.JSX.Element {
  const [content, setContent] = useState<MailContent | null>(null)
  const [showHtml, setShowHtml] = useState(true)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  // External images (http/https) are blocked by default to defeat tracking pixels.
  // The user can reveal them per-message via the "Показать картинки" button.
  const [showImages, setShowImages] = useState(false)

  useEffect(() => {
    if (!account || !mailId) {
      setContent(null)
      return
    }
    let cancelled = false
    // Reset image-blocking each time a new message opens.
    setShowImages(false)
    const loadContent = async () => {
      setLoading(true)
      try {
        const res = await window.electronAPI?.fetchMailContent(account.id, mailId)
        if (cancelled) return
        if (res?.success && res?.data) {
          setContent(res.data as MailContent)
        } else {
          toast.error(res?.error || 'Не удалось загрузить письмо')
        }
      } catch (e: any) {
        if (!cancelled) toast.error(`Ошибка: ${e?.message}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadContent()
    return () => { cancelled = true }
  }, [account, mailId])

  const handleCopyText = useCallback(() => {
    if (!content) return
    navigator.clipboard.writeText(content.textBody || content.htmlBody?.replace(/<[^>]+>/g, '') || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [content])

  // Save an attachment to disk via the main process (native save dialog + fs write)
  const handleSaveAttachment = useCallback(
    async (attachmentId: string, filename: string) => {
      if (!account || !mailId) return
      try {
        const res = await window.electronAPI?.saveAttachment(account.id, mailId, attachmentId)
        if (res?.success) {
          toast.success(`Сохранено: ${filename}`)
        } else if (res?.error !== 'Save cancelled') {
          toast.error(res?.error || 'Не удалось сохранить вложение')
        }
      } catch (e: any) {
        toast.error(`Ошибка сохранения: ${e?.message}`)
      }
    },
    [account, mailId],
  )

  // Export the current message to disk in the chosen format.
  const handleExport = useCallback(
    async (format: 'eml' | 'html' | 'txt') => {
      if (!account || !mailId || !content) return
      const suggestedName = content.subject || `message-${mailId}`
      const body =
        format === 'html'
          ? content.htmlBody || `<pre>${content.textBody || ''}</pre>`
          : format === 'txt'
            ? content.textBody || content.htmlBody?.replace(/<[^>]+>/g, '') || ''
            : undefined
      try {
        const res = await window.electronAPI?.exportMail({
          accountId: account.id,
          uid: mailId,
          format,
          content: body,
          suggestedName,
        })
        if (res?.success) {
          toast.success(`Экспортировано (.${format})`)
        } else if (res?.error !== 'Save cancelled') {
          toast.error(res?.error || 'Не удалось экспортировать письмо')
        }
      } catch (e: any) {
        toast.error(`Ошибка экспорта: ${e?.message}`)
      }
    },
    [account, mailId, content],
  )

  if (!account || !mailId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-sm text-muted-foreground gap-3 bg-panel">
        <div className="w-14 h-14 rounded-2xl bg-muted/30 flex items-center justify-center">
          <Mail className="h-7 w-7 opacity-40" />
        </div>
        <p className="text-muted-foreground/70">Выберите письмо для просмотра</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-5 space-y-4 bg-panel">
        <div className="flex gap-3">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <Separator />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground bg-panel">
        <p className="text-muted-foreground/60">Письмо не загружено</p>
      </div>
    )
  }

  // Extract sender display name (strip email from "Name <email>")
  const fromName = content.fromName ? content.fromName.replace(/<[^>]+>/g, '').trim() : 'Неизвестный'
  const fromEmail = content.fromEmail || ''
  const initials = getInitials(fromName, fromEmail)
  const colors = hashGradient(fromEmail || fromName)

  return (
    <div className="flex flex-col h-full bg-panel">
      {/* Header — subject + actions */}
      <div className="px-4 py-3 border-b border-border/60">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold leading-tight flex-1 truncate pr-3">
            {content.subject || '(Без темы)'}
          </h2>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* HTML / Text toggle */}
            <div className="flex items-center gap-1 mr-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-7 px-2 text-[11px] gap-1', showHtml && 'bg-muted')}
                onClick={() => setShowHtml(true)}
                title="HTML вид"
              >
                <Code2 className="h-3 w-3" /> HTML
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn('h-7 px-2 text-[11px] gap-1', !showHtml && 'bg-muted')}
                onClick={() => setShowHtml(false)}
                title="Текстовый вид"
              >
                <FileText className="h-3 w-3" /> Текст
              </Button>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyText} title="Копировать текст">
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Экспорт письма">
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport('eml')}>
                  Экспорт в .eml (исходник)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('html')}>
                  Экспорт в .html
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport('txt')}>
                  Экспорт в .txt
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Sender info row */}
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center text-sm font-bold text-white shadow-md flex-shrink-0',
            colors,
          )}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground/90 truncate">{fromName}</span>
              {fromEmail && (
                <span className="text-xs text-muted-foreground/60 truncate">{'<'}{fromEmail}{'>'}</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[10px] text-muted-foreground/50">
                кому: <span className="text-foreground/70">{content.to || '—'}</span>
              </span>
              <span className="text-[10px] text-muted-foreground/40">
                {new Date(content.date).toLocaleString('ru')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <ScrollArea className="flex-1 scrollbar-thin">
        <div className="p-4">
          {showHtml && content.htmlBody ? (
            (() => {
              // 1. Sanitize with DOMPurify. 2. Block remote images unless the
              // user opted in. 3. Render inside a script-free sandboxed iframe.
              const clean = sanitizeHtml(content.htmlBody)
              const blocked = !showImages && hasExternalImages(clean)
              const finalHtml = blocked ? blockExternalImages(clean) : clean
              return (
                <>
                  {blocked && (
                    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                      <span className="text-amber-200/90">
                        Внешние изображения заблокированы для защиты от трекинга.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] flex-shrink-0"
                        onClick={() => setShowImages(true)}
                      >
                        <ImageIcon className="h-3 w-3 mr-1" /> Показать картинки
                      </Button>
                    </div>
                  )}
                  <SandboxedHtml html={finalHtml} />
                </>
              )
            })()
          ) : (
            <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground/85">{content.textBody || content.htmlBody?.replace(/<[^>]+>/g, '') || '(Пустое письмо)'}</pre>
          )}

          {/* Attachments — inline (cid:) images are embedded in the body, so
              they're excluded from the downloadable-file list. */}
          {(() => {
            const files = (content.attachments || []).filter((a) => !a.isInline)
            if (files.length === 0) return null
            return (
              <>
                <Separator className="my-6" />
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground/90">
                    <Paperclip className="h-4 w-4" /> Вложения ({files.length})
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {files.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-muted/30 hover:bg-muted/60 hover:border-border transition-all cursor-pointer group"
                        onClick={() => handleSaveAttachment(att.id, att.filename)}
                        title={`Сохранить ${att.filename}`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Paperclip className="h-3.5 w-3.5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{att.filename}</div>
                            <div className="text-[10px] text-muted-foreground/50">{formatSize(att.size)}</div>
                          </div>
                        </div>
                        <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="w-6 h-6 rounded-md bg-foreground/10 flex items-center justify-center hover:bg-foreground/20">
                            <Download className="h-3 w-3" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      </ScrollArea>
    </div>
  )

}

// Sanitize untrusted email HTML with DOMPurify (proper DOM-based parser).
// The previous regex-based approach was trivially bypassable (unquoted
// attributes, split tags, <svg>/<math> vectors, data: URIs, CSS expressions).
// DOMPurify strips scripts, event handlers, and dangerous protocols robustly.
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    // Remove entire disallowed elements incl. their content
    FORBID_TAGS: ['script', 'style', 'iframe', 'embed', 'object', 'applet', 'form', 'base', 'link', 'meta'],
    FORBID_ATTR: ['srcset', 'formaction', 'action'],
    // Block javascript:, data: (except images), vbscript: protocols
    ALLOW_UNKNOWN_PROTOCOLS: false,
    // Keep target-safe links; force external navigation to be inert here
    ADD_ATTR: ['target'],
  })
}

/** True if the HTML references any remote (http/https) image — a tracking risk. */
function hasExternalImages(html: string): boolean {
  return /<img\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(html)
    || /\bbackground(?:-image)?\s*:\s*url\(\s*["']?https?:\/\//i.test(html)
}

/**
 * Neutralize remote images to defeat tracking pixels: move each external src to
 * data-blocked-src and drop the live src. Inline data:/cid: images are untouched.
 * Uses a real DOM parse (not regex) so malformed markup can't slip through.
 */
function blockExternalImages(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || ''
      if (/^https?:\/\//i.test(src)) {
        img.setAttribute('data-blocked-src', src)
        img.removeAttribute('src')
      }
      // Also strip srcset which can carry remote URLs
      if (img.hasAttribute('srcset')) img.removeAttribute('srcset')
    })
    // Strip remote CSS background images from inline styles
    doc.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
      const style = el.getAttribute('style') || ''
      if (/url\(\s*["']?https?:\/\//i.test(style)) {
        el.setAttribute('style', style.replace(/background(?:-image)?\s*:\s*url\([^)]*\)\s*;?/gi, ''))
      }
    })
    return doc.body.innerHTML
  } catch {
    return html
  }
}

