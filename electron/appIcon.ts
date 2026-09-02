/**
 * Application icon resolution for the main process (window + tray).
 *
 * - dev:   <project>/resources/icon.ico (fallback: <project>/icon.ico)
 * - prod:  electron-builder.yml packs resources/** and asarUnpacks them,
 *          so the file sits at <install>/resources/app.asar.unpacked/resources/icon.ico
 *
 * Returns '' when nothing is found — callers fall back to their defaults.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function resolveAppIconPath(): string {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'icon.ico'),
        join(process.resourcesPath, 'icon.ico'),
      ]
    : [
        join(app.getAppPath(), 'resources', 'icon.ico'),
        join(app.getAppPath(), 'icon.ico'),
      ]
  for (const p of candidates) {
    try {
      if (existsSync(p)) return p
    } catch {
      // probe failures are non-fatal
    }
  }
  return ''
}
