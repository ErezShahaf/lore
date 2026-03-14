import { useState } from 'react'
import { Settings, Cpu, Info, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettings } from '@/hooks/useSettings'
import { ScrollArea } from '@/components/ui/scroll-area'
import { GeneralSettings } from './GeneralSettings'
import { ModelSettings } from './ModelSettings'
import { AboutSettings } from './AboutSettings'

type Tab = 'general' | 'model' | 'about'

const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'model', label: 'Model', icon: Cpu },
  { id: 'about', label: 'About', icon: Info },
]

function TitleBar() {
  return (
    <div
      className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-[#0d0d0d] px-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-xs font-semibold text-foreground">Lore Settings</span>
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => window.loreAPI.minimizeWindow()}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          onClick={() => window.loreAPI.closeWindow()}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/80 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export function SettingsWindow() {
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const { settings, loading, update } = useSettings()

  if (loading || !settings) {
    return (
      <div className="flex h-screen flex-col bg-background">
        <TitleBar />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-48 shrink-0 flex-col border-r border-border bg-[#0d0d0d] p-3">
          <div className="space-y-0.5">
            {tabs.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    activeTab === tab.id
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </nav>

        <ScrollArea className="flex-1">
          <main className="p-8">
            {activeTab === 'general' && (
              <GeneralSettings settings={settings} onUpdate={update} />
            )}
            {activeTab === 'model' && (
              <ModelSettings settings={settings} onUpdate={update} />
            )}
            {activeTab === 'about' && <AboutSettings />}
          </main>
        </ScrollArea>
      </div>
    </div>
  )
}
