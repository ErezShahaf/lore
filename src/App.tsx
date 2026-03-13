import { ChatWindow } from '@/components/chat/ChatWindow'
import { SettingsWindow } from '@/components/settings/SettingsWindow'
import { SetupWindow } from '@/components/setup/SetupWindow'

function getWindowType(): 'chat' | 'settings' | 'setup' {
  const params = new URLSearchParams(window.location.search)
  const w = params.get('window')
  if (w === 'settings') return 'settings'
  if (w === 'setup') return 'setup'
  return 'chat'
}

function App() {
  const windowType = getWindowType()

  if (windowType === 'settings') return <SettingsWindow />
  if (windowType === 'setup') return <SetupWindow />

  return <ChatWindow />
}

export default App
