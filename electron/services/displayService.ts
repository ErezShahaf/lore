import { screen } from 'electron'
import { getSettings } from './settingsService'
import type { DisplayInfo } from '../../shared/types'

export function listDisplays(): DisplayInfo[] {
  const primaryDisplayId = screen.getPrimaryDisplay().id

  return screen.getAllDisplays().map((display, index) => ({
    id: display.id,
    label: `Display ${index + 1} (${display.workArea.width}x${display.workArea.height})`,
    isPrimary: display.id === primaryDisplayId,
  }))
}

export function getPreferredDisplay(): Electron.Display {
  const { preferredDisplayId } = getSettings()
  if (preferredDisplayId !== null) {
    const matchingDisplay = screen.getAllDisplays().find((display) => display.id === preferredDisplayId)
    if (matchingDisplay) {
      return matchingDisplay
    }
  }

  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}
