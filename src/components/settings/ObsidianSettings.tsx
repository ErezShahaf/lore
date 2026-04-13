import { useState, useEffect, useCallback } from 'react'
import { FolderOpen, Plus, Trash2, RefreshCw, ChevronDown, ChevronUp, Edit3, Check, X, Tag } from 'lucide-react'
import type { AppSettings, ObsidianVaultConfig, ObsidianSyncStatus } from '../../../shared/types'

interface ObsidianSettingsProps {
  settings: AppSettings
  onUpdate: (updates: Partial<AppSettings>) => void
}

export function ObsidianSettings({ settings, onUpdate }: ObsidianSettingsProps) {
  const vaults = settings.obsidianVaults ?? []
  const [syncStatuses, setSyncStatuses] = useState<ObsidianSyncStatus[]>([])
  const [expandedVault, setExpandedVault] = useState<string | null>(null)
  const [showAddVault, setShowAddVault] = useState(false)
  const [tagCount, setTagCount] = useState(0)
  const [allTags, setAllTags] = useState<string[]>([])
  const [showTags, setShowTags] = useState(false)

  // Poll sync status
  useEffect(() => {
    const poll = () => {
      window.loreAPI.obsidianSyncStatus().then(setSyncStatuses).catch(() => {})
      window.loreAPI.obsidianGetTags().then(({ tags, count }) => {
        setTagCount(count)
        setAllTags(tags)
      }).catch(() => {})
    }
    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [])

  // Listen for sync progress events
  useEffect(() => {
    const unsub = window.loreAPI.onObsidianSyncProgress((status) => {
      setSyncStatuses(prev => {
        const idx = prev.findIndex(s => s.vaultId === status.vaultId)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = status
          return next
        }
        return [...prev, status]
      })
    })
    return unsub
  }, [])

  const getStatusForVault = useCallback((vaultId: string) => {
    return syncStatuses.find(s => s.vaultId === vaultId)
  }, [syncStatuses])

  const handleSyncVault = (vaultId: string) => {
    window.loreAPI.obsidianSyncVault(vaultId)
  }

  const handleWipeAndResync = async (vaultId: string) => {
    await window.loreAPI.obsidianWipeAndResync(vaultId)
  }

  const handleRemoveVault = async (vaultId: string) => {
    await window.loreAPI.obsidianRemoveVault(vaultId)
  }

  const handleToggleVault = async (vaultId: string, enabled: boolean) => {
    await window.loreAPI.obsidianUpdateVault(vaultId, { enabled })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Obsidian Integration</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your Obsidian vaults to extend your knowledge base with vault notes.
        </p>
      </div>

      {/* Vault List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Vaults</h3>
          <button
            onClick={() => setShowAddVault(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            <Plus className="size-3.5" />
            Add Vault
          </button>
        </div>

        {vaults.length === 0 && !showAddVault && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No vaults configured. Add an Obsidian vault to start indexing your notes.
            </p>
          </div>
        )}

        {showAddVault && (
          <AddVaultForm
            onAdd={() => setShowAddVault(false)}
            onCancel={() => setShowAddVault(false)}
          />
        )}

        {vaults.map(vault => (
          <VaultCard
            key={vault.id}
            vault={vault}
            syncStatus={getStatusForVault(vault.id)}
            expanded={expandedVault === vault.id}
            onToggleExpand={() => setExpandedVault(expandedVault === vault.id ? null : vault.id)}
            onSync={() => handleSyncVault(vault.id)}
            onWipeAndResync={() => handleWipeAndResync(vault.id)}
            onRemove={() => handleRemoveVault(vault.id)}
            onToggleEnabled={(enabled) => handleToggleVault(vault.id, enabled)}
          />
        ))}
      </div>

      {/* Auto-sync Settings */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Auto-sync</h3>
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={settings.obsidianAutoSync}
                onChange={(e) => onUpdate({ obsidianAutoSync: e.target.checked })}
                className="size-4 rounded border-border bg-background accent-primary"
              />
              <span className="text-sm text-foreground">Auto-sync vaults</span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Every</span>
            <select
              value={settings.obsidianSyncIntervalMinutes}
              onChange={(e) => onUpdate({ obsidianSyncIntervalMinutes: Number(e.target.value) })}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="5">5 min</option>
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="60">60 min</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tag Pool */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Tag Pool</h3>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="size-4 text-muted-foreground" />
              <span className="text-sm text-foreground">
                {tagCount} unique tag{tagCount !== 1 ? 's' : ''} across all vaults
              </span>
            </div>
            <button
              onClick={() => setShowTags(!showTags)}
              className="text-xs text-primary hover:underline"
            >
              {showTags ? 'Hide' : 'View tags'}
            </button>
          </div>
          {showTags && allTags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {allTags.slice(0, 100).map(tag => (
                <span
                  key={tag}
                  className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
              {allTags.length > 100 && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground italic">
                  +{allTags.length - 100} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Add Vault Form ────────────────────────────────────────────

function AddVaultForm({ onAdd, onCancel }: { onAdd: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [vaultPath, setVaultPath] = useState('')
  const [templateFolder, setTemplateFolder] = useState('Templates')
  const [noteDestination, setNoteDestination] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleBrowse = async () => {
    const path = await window.loreAPI.obsidianPickVaultFolder()
    if (path) {
      setVaultPath(path)
      // Auto-populate name from folder name
      if (!name) {
        const parts = path.split(/[/\\]/)
        setName(parts[parts.length - 1] || 'My Vault')
      }
    }
  }

  const handleSubmit = async () => {
    if (!vaultPath.trim()) {
      setError('Please select a vault folder')
      return
    }
    setLoading(true)
    setError('')

    const result = await window.loreAPI.obsidianAddVault({
      name: name.trim() || 'My Vault',
      vaultPath: vaultPath.trim(),
      templateFolder: templateFolder.trim(),
      noteDestination: noteDestination.trim(),
    })

    setLoading(false)
    if (result.success) {
      onAdd()
    } else {
      setError(result.error || 'Failed to add vault')
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-3">
      <h4 className="text-sm font-medium text-foreground">Add Obsidian Vault</h4>

      <div className="space-y-2">
        <label className="block text-xs text-muted-foreground">Vault Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Work, Personal"
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50"
        />
      </div>

      <div className="space-y-2">
        <label className="block text-xs text-muted-foreground">Vault Path</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={vaultPath}
            readOnly
            placeholder="Select vault folder..."
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50"
          />
          <button
            onClick={handleBrowse}
            className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary/80"
          >
            <FolderOpen className="size-3.5" />
            Browse
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">Template Folder (relative)</label>
          <input
            type="text"
            value={templateFolder}
            onChange={(e) => setTemplateFolder(e.target.value)}
            placeholder="Templates"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">New Notes Destination (relative)</label>
          <input
            type="text"
            value={noteDestination}
            onChange={(e) => setNoteDestination(e.target.value)}
            placeholder="e.g. Lore/Inbox"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Adding...' : 'Add Vault'}
        </button>
      </div>
    </div>
  )
}

// ── Vault Card ────────────────────────────────────────────────

interface VaultCardProps {
  vault: ObsidianVaultConfig
  syncStatus: ObsidianSyncStatus | undefined
  expanded: boolean
  onToggleExpand: () => void
  onSync: () => void
  onWipeAndResync: () => void
  onRemove: () => void
  onToggleEnabled: (enabled: boolean) => void
}

function VaultCard({ vault, syncStatus, expanded, onToggleExpand, onSync, onWipeAndResync, onRemove, onToggleEnabled }: VaultCardProps) {
  const isSyncing = syncStatus?.phase === 'scanning' || syncStatus?.phase === 'embedding'
  const lastSynced = vault.lastSyncedAt
    ? formatTimeAgo(new Date(vault.lastSyncedAt))
    : 'Never synced'
  const notesCount = syncStatus?.notesIndexed ?? 0

  return (
    <div className={`rounded-lg border ${vault.enabled ? 'border-border' : 'border-border/50 opacity-60'} bg-card overflow-hidden transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3 min-w-0">
          <input
            type="checkbox"
            checked={vault.enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            className="size-4 rounded border-border bg-background accent-primary shrink-0"
          />
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-foreground truncate">{vault.name}</h4>
            <p className="text-xs text-muted-foreground truncate">{vault.vaultPath}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Sync status indicator */}
          <span className={`inline-flex items-center gap-1 text-xs ${
            isSyncing ? 'text-primary' :
            syncStatus?.phase === 'error' ? 'text-destructive' :
            'text-muted-foreground'
          }`}>
            {isSyncing && <RefreshCw className="size-3 animate-spin" />}
            {isSyncing
              ? `${syncStatus?.filesProcessed ?? 0}/${syncStatus?.totalFiles ?? '?'} files`
              : lastSynced
            }
            {notesCount > 0 && !isSyncing && ` (${notesCount} chunks)`}
          </span>

          <button
            onClick={onSync}
            disabled={isSyncing}
            title="Sync now"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <RefreshCw className={`size-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={onWipeAndResync}
            disabled={isSyncing}
            title="Wipe & Re-sync"
            className="flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 px-2 py-1"
          >
            Wipe & Sync
          </button>

          <button
            onClick={onToggleExpand}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Progress bar during sync */}
      {isSyncing && syncStatus && syncStatus.totalFiles > 0 && (
        <div className="px-4 pb-2">
          <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(syncStatus.filesProcessed / syncStatus.totalFiles) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border bg-background/50 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">Template Folder</span>
              <p className="text-foreground">{vault.templateFolder || '(none)'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">New Notes Destination</span>
              <p className="text-foreground">{vault.noteDestination || '(vault root)'}</p>
            </div>
          </div>

          {syncStatus?.lastError && (
            <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
              Error: {syncStatus.lastError}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={onRemove}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
              Remove Vault
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────

function formatTimeAgo(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
