import { type SVGProps } from 'react'
import { Github, Linkedin, Twitter } from 'lucide-react'

function DiscordIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
    </svg>
  )
}

const LINKS = [
  {
    icon: Github,
    label: 'Lore GitHub Repository',
    url: 'https://github.com/ErezShahaf/Lore',
  },
  {
    icon: DiscordIcon,
    label: 'Community Discord',
    url: 'https://discord.gg/hsrsertbdb',
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
