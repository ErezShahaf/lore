import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '../../../shared/types'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('animate-slide-up flex min-w-0 w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 max-w-[75%] overflow-hidden break-words rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary/20 text-foreground'
            : 'bg-secondary/60 text-foreground',
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <>
            {message.content ? (
              <Markdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0 break-words">{children}</p>,
                  ul: ({ children }) => (
                    <ul className="mb-2 list-disc pl-4 last:mb-0 break-words">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-2 list-decimal pl-4 last:mb-0 break-words">{children}</ol>
                  ),
                  li: ({ children }) => <li className="mb-0.5 break-words">{children}</li>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes('language-')
                    if (isBlock) {
                      return (
                        <pre className="my-2 min-w-0 max-w-full whitespace-pre-wrap break-all rounded-md bg-[#0a0a0a] p-3 text-xs">
                          <code>{children}</code>
                        </pre>
                      )
                    }
                    return (
                      <code className="break-all rounded bg-[#0a0a0a] px-1.5 py-0.5 text-xs">
                        {children}
                      </code>
                    )
                  },
                  pre: ({ children }) => <>{children}</>,
                }}
              >
                {message.content}
              </Markdown>
            ) : null}
            {message.isStreaming && (
              <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground/70" />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function TypingIndicator() {
  return (
    <div className="animate-fade-in flex justify-start">
      <div className="flex items-center gap-1.5 rounded-xl bg-secondary/60 px-4 py-3">
        <span className="size-1.5 rounded-full bg-muted-foreground animate-typing-dot" />
        <span className="size-1.5 rounded-full bg-muted-foreground animate-typing-dot [animation-delay:0.2s]" />
        <span className="size-1.5 rounded-full bg-muted-foreground animate-typing-dot [animation-delay:0.4s]" />
      </div>
    </div>
  )
}
