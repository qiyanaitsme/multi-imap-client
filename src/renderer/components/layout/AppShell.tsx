"use client"

import { useState, useCallback, useEffect } from 'react'
import TitleBar from './TitleBar'
import Sidebar from './Sidebar'
import StatusBar from './StatusBar'
import MailList from '../mail/MailList'
import MailViewer from '../mail/MailViewer'
import ImportDialog from '../config/ImportDialog'
import ProxyManager from '../proxy/ProxyManager'
import Dashboard from '../dashboard/Dashboard'
import CommandPalette from '../command/CommandPalette'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Account, useAccountStore } from '@/store/useAccountStore'
import { useUiStore } from '@/store/useUiStore'

export default function AppShell(): React.JSX.Element {
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null)
  const [selectedMailId, setSelectedMailId] = useState<string | null>(null)
  const sidebarTab = useUiStore((s) => s.sidebarTab)
  const setSidebarTab = useUiStore((s) => s.setSidebarTab)
  const commandOpen = useUiStore((s) => s.commandOpen)
  const setCommandOpen = useUiStore((s) => s.setCommandOpen)

  const handleAccountSelect = useCallback((account: Account) => {
    setSelectedAccount(account)
    setSelectedMailId(null)
  }, [])

  const handleMailSelect = useCallback((mailId: string) => {
    setSelectedMailId(mailId)
  }, [])

  // Ctrl+Tab / Ctrl+Shift+Tab — cycle through accounts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        const accounts = useAccountStore.getState().accounts
        if (accounts.length === 0) return
        const curIdx = accounts.findIndex((a) => a.id === selectedAccount?.id)
        const dir = e.shiftKey ? -1 : 1
        const nextIdx = curIdx === -1 ? 0 : (curIdx + dir + accounts.length) % accounts.length
        setSidebarTab('accounts')
        handleAccountSelect(accounts[nextIdx])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedAccount, handleAccountSelect, setSidebarTab])

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
      <TitleBar />
      <div className="flex-1 flex flex-row overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Sidebar */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
            <div className="h-full flex flex-col">
              <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as 'accounts' | 'config' | 'proxy')} className="flex flex-col h-full">
                <div className="px-2 pt-2 pb-1.5 border-b border-border/40">
                  <TabsList className="w-full">
                    <TabsTrigger value="dashboard" className="flex-1 text-xs">Дашборд</TabsTrigger>
                    <TabsTrigger value="accounts" className="flex-1 text-xs">Аккаунты</TabsTrigger>
                    <TabsTrigger value="config" className="flex-1 text-xs">Конфиг</TabsTrigger>
                    <TabsTrigger value="proxy" className="flex-1 text-xs">Прокси</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="dashboard" className="flex-1 p-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                  <Dashboard />
                </TabsContent>
                <TabsContent value="accounts" className="flex-1 p-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                  <Sidebar
                    selectedAccount={selectedAccount}
                    onAccountSelect={handleAccountSelect}
                  />
                </TabsContent>
                <TabsContent value="config" className="flex-1 p-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col scrollbar-thin">
                  <ImportDialog />
                </TabsContent>
                <TabsContent value="proxy" className="flex-1 p-0 overflow-hidden data-[state=active]:flex data-[state=active]:flex-col">
                  <ProxyManager />
                </TabsContent>
              </Tabs>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="w-1 bg-border/40 hover:bg-primary/40 transition-colors">
            <div className="h-8 w-1 rounded-full bg-muted-foreground/20" />
          </ResizableHandle>

          {/* Mail List */}
          <ResizablePanel defaultSize={35} minSize={0}>
            <div className="h-full">
              <MailList
                account={selectedAccount}
                selectedMailId={selectedMailId}
                onMailSelect={handleMailSelect}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="w-1 bg-border/40 hover:bg-primary/40 transition-colors">
            <div className="h-8 w-1 rounded-full bg-muted-foreground/20" />
          </ResizableHandle>

          {/* Mail Viewer */}
          <ResizablePanel defaultSize={45}>
            <div className="h-full">
              <MailViewer
                account={selectedAccount}
                mailId={selectedMailId}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <StatusBar />

      {/* Global command palette (Ctrl+K) */}
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onSelectAccount={handleAccountSelect}
        onSelectTab={setSidebarTab}
      />
    </div>
  )
}
