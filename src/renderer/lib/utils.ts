import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Shared UI helpers used by MailList, MailViewer and AccountItem.
 * Extracted to satisfy DRY — these were previously copy-pasted per component.
 */

/** Deterministic gradient classes for an arbitrary string (sender email, domain…). */
export function hashGradient(str: string): string {
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
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return palette[Math.abs(hash) % palette.length]
}

/** Initials for avatars: "Иван Иванов" -> "ИИ", falls back to email or "?". */
export function getInitials(name?: string | null, email?: string | null): string {
  const cleaned = (name ?? '').replace(/<[^>]+>/g, '').trim()
  if (cleaned && cleaned !== 'Неизвестный') {
    const parts = cleaned.split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return cleaned.substring(0, 2).toUpperCase()
  }
  if (email) return email.substring(0, 2).toUpperCase()
  return '?'
}

/** Human-readable file size: B / KB / MB. */
export function formatSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
