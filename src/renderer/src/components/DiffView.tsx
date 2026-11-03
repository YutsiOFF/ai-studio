import { diffLines } from 'diff'
import { useMemo } from 'react'
import { cn } from './ui'

interface Line {
  kind: 'add' | 'del' | 'ctx' | 'gap'
  text: string
  a?: number
  b?: number
}

/** Affichage avant / après d'une modification de fichier (format unifié). */
export function DiffView({ before, after, maxHeight = 360 }: { before: string | null; after: string | null; maxHeight?: number }) {
  const lines = useMemo<Line[]>(() => {
    const parts = diffLines(before ?? '', after ?? '')
    const out: Line[] = []
    let a = 1
    let b = 1
    for (const p of parts) {
      const rows = p.value.replace(/\n$/, '').split('\n')
      if (p.added) for (const t of rows) out.push({ kind: 'add', text: t, b: b++ })
      else if (p.removed) for (const t of rows) out.push({ kind: 'del', text: t, a: a++ })
      else {
        // Contexte réduit : 3 lignes autour des modifications.
        if (rows.length > 8) {
          rows.slice(0, 3).forEach((t) => out.push({ kind: 'ctx', text: t, a: a++, b: b++ }))
          out.push({ kind: 'gap', text: `… ${rows.length - 6} lignes inchangées` })
          a += rows.length - 6
          b += rows.length - 6
          rows.slice(-3).forEach((t) => out.push({ kind: 'ctx', text: t, a: a++, b: b++ }))
        } else rows.forEach((t) => out.push({ kind: 'ctx', text: t, a: a++, b: b++ }))
      }
    }
    if (out.length && out[0]!.kind === 'ctx' && before === null) return out
    return out
  }, [before, after])

  const added = lines.filter((l) => l.kind === 'add').length
  const removed = lines.filter((l) => l.kind === 'del').length

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-bg">
      <div className="flex gap-3 border-b border-line px-3 py-1.5 font-mono text-[11px]">
        <span className="text-accent">+{added}</span>
        <span className="text-danger">−{removed}</span>
      </div>
      <div className="overflow-auto font-mono text-[11.5px] leading-[1.55]" style={{ maxHeight }} data-selectable>
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              'flex whitespace-pre',
              l.kind === 'add' && 'bg-accent/10 text-[#9ff0c9]',
              l.kind === 'del' && 'bg-danger/10 text-[#fca5a5]',
              l.kind === 'ctx' && 'text-fg-muted',
              l.kind === 'gap' && 'bg-surface-2 text-fg-subtle italic'
            )}
          >
            <span className="w-10 shrink-0 pr-2 text-right text-fg-subtle/70 select-none">{l.a ?? ''}</span>
            <span className="w-10 shrink-0 pr-2 text-right text-fg-subtle/70 select-none">{l.b ?? ''}</span>
            <span className="w-4 shrink-0 select-none">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ''}</span>
            <span className="pr-4">{l.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
