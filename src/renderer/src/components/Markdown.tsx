import { Check, Copy } from 'lucide-react'
import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-line bg-bg">
      <div className="flex items-center justify-between border-b border-line px-3 py-1 text-[11px] text-fg-subtle">
        <span className="font-mono">{lang ?? 'code'}</span>
        <button
          className="flex items-center gap-1 hover:text-fg"
          onClick={() => {
            void navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-fg">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md" data-selectable>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const m = /language-(\w+)/.exec(className ?? '')
            const content = String(children).replace(/\n$/, '')
            if (!m && !content.includes('\n')) return <code className="inline">{children}</code>
            return <CodeBlock code={content} lang={m?.[1]} />
          },
          pre: ({ children }) => <>{children}</>
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
