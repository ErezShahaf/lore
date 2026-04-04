import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FolderOpen, X } from 'lucide-react'
import type { AgentOrchestrationMode, AppSettings, DisplayInfo } from '../../../shared/types'

interface GeneralSettingsProps {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
}

export function GeneralSettings({ settings, onUpdate }: GeneralSettingsProps) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])

  useEffect(() => {
    let isMounted = true

    void window.loreAPI.getDisplays().then((availableDisplays) => {
      if (isMounted) {
        setDisplays(availableDisplays)
      }
    })

    return () => {
      isMounted = false
    }
  }, [])

  const handlePickModelsFolder = async () => {
    const folder = await window.loreAPI.setupPickModelsFolder()
    if (folder) onUpdate({ ollamaModelsPath: folder })
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">General</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure app behavior and preferences.
        </p>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Keyboard Shortcut
          </label>
          <Input
            value={settings.shortcut}
            onChange={e => onUpdate({ shortcut: e.target.value })}
            className="max-w-xs"
          />
          <p className="text-xs text-muted-foreground">
            Global shortcut to toggle the Lore popup.
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium text-foreground">Start on login</p>
            <p className="text-xs text-muted-foreground">
              Launch Lore automatically when you log in.
            </p>
          </div>
          <button
            onClick={() => onUpdate({ startOnLogin: !settings.startOnLogin })}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              settings.startOnLogin ? 'bg-primary' : 'bg-secondary'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform ${
                settings.startOnLogin ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Chat Display</label>
          <select
            value={settings.preferredDisplayId === null ? 'auto' : String(settings.preferredDisplayId)}
            onChange={(event) => {
              const nextValue = event.target.value
              onUpdate({
                preferredDisplayId: nextValue === 'auto' ? null : Number(nextValue),
              })
            }}
            className="max-w-sm rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="auto">Auto (screen nearest to cursor)</option>
            {displays.map((display) => (
              <option key={display.id} value={String(display.id)}>
                {display.label}{display.isPrimary ? ' - Primary' : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Choose where the chat window appears. Auto follows the screen nearest to your cursor.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Agent orchestration</label>
          <select
            value={settings.agentOrchestrationMode}
            onChange={(event) => {
              onUpdate({
                agentOrchestrationMode: event.target.value as AgentOrchestrationMode,
              })
            }}
            className="max-w-lg rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="classify_handlers">Classic (unified classifier, then handlers)</option>
            <option value="native_tool_loop">Native tool loop (unified agent, full tools)</option>
          </select>
          <p className="text-xs text-muted-foreground">
            One composed prompt decides search, save, and edit tools per turn (JSON tool protocol over chat). Use classic if your model does not follow tool JSON reliably.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Model Storage Location</label>
          <div className="flex gap-2">
            <div className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground truncate font-mono">
              {settings.ollamaModelsPath || 'Default (~/.ollama/models)'}
            </div>
            <Button variant="outline" size="sm" onClick={handlePickModelsFolder}>
              <FolderOpen className="size-4" />
              Browse
            </Button>
            {settings.ollamaModelsPath && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onUpdate({ ollamaModelsPath: '' })}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Where downloaded AI models are stored. The AI engine will restart automatically when changed.
          </p>
        </div>
      </div>
    </div>
  )
}
