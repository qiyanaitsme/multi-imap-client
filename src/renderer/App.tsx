import { useEffect } from 'react'
import { toast } from 'sonner'
import { Toaster } from 'sonner'
import AppShell from './components/layout/AppShell'
import { useSettingsStore } from './store/useSettingsStore'

function App(): React.JSX.Element {
  const loadSettings = useSettingsStore((s) => s.loadSettings)

  // Load persisted user settings once on startup.
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Auto-update notifications (packaged builds only; no-op in dev).
  useEffect(() => {
    const off = window.electronAPI?.on('updater:status', (payload: unknown) => {
      const s = payload as { state: string; version?: string; percent?: number; message?: string }
      switch (s.state) {
        case 'available':
          toast.info(`Доступно обновление ${s.version ?? ''}. Загрузка...`)
          break
        case 'downloaded':
          toast.success(`Обновление ${s.version ?? ''} готово`, {
            description: 'Перезапустите приложение для установки',
            action: {
              label: 'Перезапустить',
              onClick: () => window.electronAPI?.installUpdate(),
            },
            duration: Infinity,
          })
          break
        case 'error':
          // Silent for offline/no-feed; log for diagnostics only.
          console.warn('[updater]', s.message)
          break
      }
    })
    return () => { off?.() }
  }, [])

  return (
    <>
      <AppShell />
      <Toaster position="bottom-right" richColors closeButton />
    </>
  )
}

export default App