import { contextBridge, ipcRenderer } from 'electron'

const loreAPI = {
  ping: () => ipcRenderer.invoke('ping'),
}

contextBridge.exposeInMainWorld('loreAPI', loreAPI)

declare global {
  interface Window {
    loreAPI: typeof loreAPI
  }
}
