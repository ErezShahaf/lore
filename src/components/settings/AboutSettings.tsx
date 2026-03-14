import { Github, Linkedin, Twitter } from 'lucide-react'

const LINKS = [
  {
    icon: Github,
    label: 'Lore GitHub Repository',
    url: 'https://github.com/ErezShahaf/Lore',
  },
  {
    icon: Linkedin,
    label: 'LinkedIn Profile',
    url: 'https://www.linkedin.com/in/erez-shahaf-563640197/',
  },
  {
    icon: Twitter,
    label: 'X / Twitter Profile',
    url: 'https://x.com/shahaf_erez',
  },
] as const

export function AboutSettings() {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">About</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Information about Lore.
        </p>
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium text-foreground">Created by Erez Shahaf</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Built with care for developers who value privacy and local-first tools.
            Your thoughts stay on your machine — always.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {LINKS.map(({ icon: Icon, label, url }) => (
              <button
                key={url}
                onClick={() => window.loreAPI.openExternal(url)}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-foreground">Version</span>
              <span className="text-sm text-muted-foreground">0.1.0</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-foreground">Electron</span>
              <span className="text-sm text-muted-foreground">
                {navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ?? '—'}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-foreground">Chrome</span>
              <span className="text-sm text-muted-foreground">
                {navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            Lore is an AI-powered thought capture and recall tool. Store
            thoughts, ask questions, and let your local LLM keep track of
            everything.
          </p>
          <p>
            Built with Electron, React, Ollama, and LanceDB.
          </p>
        </div>
      </div>
    </div>
  )
}
