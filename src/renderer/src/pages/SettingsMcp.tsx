import { CircleAlert, ExternalLink, Loader2, Plug, Plus, Trash2, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { McpServerView } from '@shared/ipc'
import { Badge, Button, Card, CardHeader, Toggle, inputClass } from '../components/ui'
import { api, useAsync, usePolling } from '../lib/hooks'
import { toast } from '../lib/toast'

/** Applications connectées à l'assistant par MCP (Model Context Protocol). */
export function McpTab() {
  const polled = usePolling(() => api.mcp.list(), 2000)
  const first = useAsync(() => api.mcp.list())
  const servers = { data: polled ?? first.data, reload: first.reload }
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Applications connectées (MCP)"
          description="L’assistant peut piloter ces applications : leurs outils sont proposés au modèle, en mode Discussion comme en mode Agent. Toute action qui modifie quelque chose te sera montrée et attendra ton autorisation."
        />
        <ul className="divide-y divide-line">
          {servers.data?.map((s) => <ServerRow key={s.id} s={s} onChange={servers.reload} />)}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Autre serveur MCP" description="Tout serveur MCP local (stdio) : Blender, Unity, Figma, bases de données… Indique la commande donnée dans sa documentation." />
        <div className="px-5 pb-5">
          {adding ? (
            <div className="space-y-2">
              <input className={inputClass} placeholder="Nom (ex. Blender)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <input className={`${inputClass} font-mono`} placeholder="Commande (ex. uvx)" value={command} onChange={(e) => setCommand(e.target.value)} />
              <input className={`${inputClass} font-mono`} placeholder="Arguments séparés par des espaces (ex. blender-mcp)" value={args} onChange={(e) => setArgs(e.target.value)} />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={!label.trim() || !command.trim()}
                  onClick={async () => {
                    const r = await api.mcp.add({ label, command, args: args.trim() ? args.trim().split(/\s+/) : [] })
                    if (!r.ok) return toast.error(r.error)
                    setAdding(false)
                    setLabel('')
                    setCommand('')
                    setArgs('')
                    void servers.reload()
                  }}
                >
                  Ajouter
                </Button>
                <Button variant="ghost" onClick={() => setAdding(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <Button icon={Plus} onClick={() => setAdding(true)}>
              Ajouter un serveur MCP
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}

function ServerRow({ s, onChange }: { s: McpServerView; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const roblox = s.preset === 'roblox'
  return (
    <li className="px-5 py-4">
      <div className="flex items-start gap-3">
        <Plug className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium">{s.label}</span>
            {s.status === 'connected' && <Badge tone="local">Connecté · {s.tools.length} outil(s)</Badge>}
            {s.status === 'connecting' && <Badge tone="neutral">Connexion…</Badge>}
            {s.status === 'error' && <Badge tone="danger">Erreur</Badge>}
            {roblox && s.detected === false && s.status !== 'connected' && <Badge tone="warn">Non détecté</Badge>}
          </div>
          {roblox ? (
            <p className="mt-1 text-[12px] text-fg-muted">
              Serveur MCP officiel intégré à Roblox Studio : lire et modifier les scripts, explorer la place, exécuter du Luau, générer des modèles, lancer des tests de jeu. Dans Studio : <span className="text-fg">Assistant › … › Manage MCP Servers › Enable Studio as MCP server</span>, puis active la connexion ici.
            </p>
          ) : (
            <p className="mt-1 font-mono text-[11.5px] text-fg-subtle">{s.command}</p>
          )}
          {s.error && (
            <p className="mt-1.5 flex gap-1.5 text-[12px] text-danger">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> {s.error}
            </p>
          )}
          {s.tools.length > 0 && (
            <button className="mt-1.5 flex items-center gap-1 text-[12px] text-cloud hover:underline" onClick={() => setShowTools((v) => !v)}>
              <Wrench className="size-3" /> {showTools ? 'Masquer les outils' : 'Voir les outils'}
            </button>
          )}
          {showTools && (
            <ul className="mt-2 space-y-1">
              {s.tools.map((t) => (
                <li key={t.name} className="text-[12px]">
                  <span className="font-mono text-fg">{t.name}</span> {t.readOnly ? <Badge tone="neutral">lecture</Badge> : <Badge tone="warn">validation</Badge>}
                  <span className="ml-1 text-fg-subtle">{t.description.split('\n')[0]?.slice(0, 140)}</span>
                </li>
              ))}
            </ul>
          )}
          {roblox && (
            <button className="mt-1.5 flex items-center gap-1 text-[12px] text-cloud hover:underline" onClick={() => api.app.openExternal('https://create.roblox.com/docs/studio/mcp')}>
              <ExternalLink className="size-3" /> Documentation Roblox
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy && <Loader2 className="size-4 animate-spin text-fg-subtle" />}
          <Toggle
            label="Connecter"
            checked={s.enabled}
            onChange={async (v) => {
              setBusy(true)
              const r = await api.mcp.setEnabled(s.id, v)
              setBusy(false)
              if (!r.ok) toast.error(r.error)
              else if (v) toast.success(`${s.label} connecté.`)
              onChange()
            }}
          />
          {!s.preset && (
            <Button
              variant="ghost"
              icon={Trash2}
              onClick={async () => {
                await api.mcp.remove(s.id)
                onChange()
              }}
            >
              Retirer
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}
