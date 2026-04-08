import type { AppSettings } from '../../shared/types'

export function resolveOllamaKeepAlive(settings: AppSettings): number | string {
  if (settings.ollamaKeepAliveMinutes < 0) {
    return -1
  }
  return `${settings.ollamaKeepAliveMinutes}m`
}
