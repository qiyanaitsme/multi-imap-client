import * as fs from 'node:fs'
import * as path from 'node:path'
import { EventEmitter } from 'node:events'

/**
 * FileWatcher monitors configuration files for changes.
 * Emits 'change' event when a watched file is modified.
 * Implements debounced monitoring (checks every 5s by default).
 */
export class FileWatcher extends EventEmitter {
  private watchedFiles: Map<string, { mtime: number; interval: NodeJS.Timeout }> = new Map()
  private pollInterval: number

  constructor(pollIntervalMs: number = 5000) {
    super()
    this.pollInterval = pollIntervalMs
  }

  /**
   * Start watching a file path.
   * @param filePath absolute path to file
   */
  watch(filePath: string): void {
    if (this.watchedFiles.has(filePath)) return

    // NOTE: the file may legitimately not exist yet (e.g. proxies.txt is
    // optional or created after startup). getMtime() returns 0 for missing
    // files, so we register the poller anyway and fire once the file appears.
    if (this.getMtime(filePath) === 0) {
      console.warn(`[FileWatcher] File not found yet, watching for creation: ${filePath}`)
    }

    const initialMtime = this.getMtime(filePath)

    const interval = setInterval(() => {
      const currentMtime = this.getMtime(filePath)
      if (currentMtime > initialMtime) {
        // Update stored mtime
        const entry = this.watchedFiles.get(filePath)
        if (entry) entry.mtime = currentMtime

        this.emit('change', filePath)
      }
    }, this.pollInterval)

    this.watchedFiles.set(filePath, { mtime: initialMtime, interval })
  }

  /**
   * Stop watching a file.
   */
  unwatch(filePath: string): void {
    const entry = this.watchedFiles.get(filePath)
    if (entry) {
      clearInterval(entry.interval)
      this.watchedFiles.delete(filePath)
    }
  }

  /**
   * Stop watching all files.
   */
  unwatchAll(): void {
    for (const [filePath] of this.watchedFiles) {
      this.unwatch(filePath)
    }
  }

  /**
   * Check if a file exists and is readable.
   */
  exists(filePath: string): boolean {
    return fs.existsSync(filePath)
  }

  /**
   * Read file contents synchronously.
   */
  readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8')
  }

  private getMtime(filePath: string): number {
    try {
      return fs.statSync(filePath).mtimeMs
    } catch {
      return 0
    }
  }
}

export default FileWatcher