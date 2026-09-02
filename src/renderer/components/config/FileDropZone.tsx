"use client"

import { useState, useRef, useCallback } from 'react'
import { UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileDropZoneProps {
  onFileDropped: (filePath: string, fileName: string, content?: string) => void
  className?: string
}

/**
 * FileDropZone — takes drag-and-drop of configuration files.
 * Reads file CONTENT in the renderer (File.text()) and passes it along with
 * the name. webUtils.getPathForFile() is used only as a fallback for the
 * path-based flow: it is unreliable in Electron 31 — a File object bridged
 * through contextBridge loses its backing blob and the call returns ''.
 */
export default function FileDropZone({ onFileDropped, className }: FileDropZoneProps): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current += 1
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragging(false)

    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // Primary flow: read contents here and hand them to the parser.
      file
        .text()
        .then((content) => onFileDropped('', file.name, content))
        .catch(() => {
          // Fallback: try to resolve an OS path for the path-based flow.
          const filePath: string = window.electronAPI?.getPathForFile(file) || ''
          if (filePath) onFileDropped(filePath, file.name)
          else onFileDropped('', file.name)
        })
    }
  }, [onFileDropped])

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'border-2 border-dashed rounded-lg px-6 py-8 text-center cursor-pointer transition-colors',
        isDragging
          ? 'border-primary bg-primary/10'
          : 'border-border bg-muted/30 hover:border-primary/50',
        className,
      )}
    >
      <UploadCloud className={cn('h-10 w-10 mx-auto mb-2', isDragging ? 'text-primary' : 'text-muted-foreground')} />
      <p className="text-sm font-medium">
        {isDragging ? 'Отпустите файл здесь' : 'Перетащите файлы конфигурации'}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        accounts.txt, imap-servers.json, proxies.txt
      </p>
    </div>
  )
}