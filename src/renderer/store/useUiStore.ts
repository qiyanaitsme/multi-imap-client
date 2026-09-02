import { create } from 'zustand'

type SidebarTab = 'dashboard' | 'accounts' | 'config' | 'proxy'

interface UiState {
  commandOpen: boolean
  sidebarTab: SidebarTab
  setCommandOpen: (open: boolean) => void
  toggleCommand: () => void
  setSidebarTab: (tab: SidebarTab) => void
}

/** Shared UI state — command palette visibility and active sidebar tab. */
export const useUiStore = create<UiState>((set, get) => ({
  commandOpen: false,
  sidebarTab: 'accounts',
  setCommandOpen: (open) => set({ commandOpen: open }),
  toggleCommand: () => set({ commandOpen: !get().commandOpen }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
}))
