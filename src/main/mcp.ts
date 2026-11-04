/**
 * Client MCP (Model Context Protocol) : connecte l'assistant à des applications externes
 * qui exposent un serveur MCP local (stdio). Préréglage : Roblox Studio, dont le serveur MCP
 * officiel est intégré à Studio (Assistant > … > Manage MCP Servers > Enable Studio as MCP server).
 * https://create.roblox.com/docs/studio/mcp
 *
 * Les outils exposés par un serveur sont proposés au modèle ; ceux qui modifient quelque chose
 * passent par la validation de l'utilisateur, comme les outils de projet.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpServerView, McpToolView } from '@shared/ipc'
import { logActivity, type Db } from './db'
import type { ToolSpec } from './providers/types'

interface McpServerConfig {
  id: string
  label: string
  command: string
  args: string[]
  enabled: boolean
  preset?: 'roblox'
}

interface Live {
  client: Client
  transport: StdioClientTransport
  tools: { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }[]
}

/** Outils Roblox Studio qui ne modifient rien (lecture, recherche, état) : pas de validation demandée. */
const ROBLOX_READ_ONLY = new Set([
  'list_roblox_studios',
  'get_studio_state',
  'get_studio_mode',
  'get_console_output',
  'script_read',
  'script_search',
  'script_grep',
  'search_game_tree',
  'inspect_instance',
  'search_asset',
  'screen_capture',
  'wait_job_finished',
  'http_get',
  'skill'
])

function robloxCommand(): { command: string; args: string[]; found: boolean; path: string } {
  if (process.platform === 'win32') {
    const bat = join(process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? 'C:\\', 'AppData', 'Local'), 'Roblox', 'mcp.bat')
    return { command: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe'), args: ['/c', bat], found: existsSync(bat), path: bat }
  }
  const p = '/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP'
  return { command: p, args: [], found: existsSync(p), path: p }
}

/** Nom d'outil accepté par les API compatibles OpenAI (^[a-zA-Z0-9_-]{1,64}$). */
function toolName(serverId: string, tool: string): string {
  return `mcp_${serverId}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

export class McpManager {
  private live = new Map<string, Live>()
  private errors = new Map<string, string>()
  private connecting = new Map<string, Promise<void>>()

  constructor(
    private readonly db: Db,
    private readonly file: string
  ) {}

  private load(): McpServerConfig[] {
    let list: McpServerConfig[] = []
    try {
      list = JSON.parse(readFileSync(this.file, 'utf8')) as McpServerConfig[]
    } catch {
      /* premier lancement */
    }
    if (!list.some((s) => s.preset === 'roblox')) {
      const r = robloxCommand()
      list.unshift({ id: 'roblox', label: 'Roblox Studio', command: r.command, args: r.args, enabled: false, preset: 'roblox' })
    }
    return list
  }

  private save(list: McpServerConfig[]): void {
    writeFileSync(this.file, JSON.stringify(list, null, 2))
  }

  list(): McpServerView[] {
    return this.load().map((s) => {
      const l = this.live.get(s.id)
      const r = s.preset === 'roblox' ? robloxCommand() : null
      return {
        id: s.id,
        label: s.label,
        command: [s.command, ...s.args].join(' '),
        enabled: s.enabled,
        preset: s.preset,
        status: l ? 'connected' : this.connecting.has(s.id) ? 'connecting' : this.errors.has(s.id) ? 'error' : 'off',
        error: this.errors.get(s.id),
        detected: r ? r.found : undefined,
        tools: l?.tools.map((t): McpToolView => ({ name: t.name, description: t.description, readOnly: t.readOnly })) ?? []
      }
    })
  }

  add(input: { label: string; command: string; args: string[] }): void {
    const list = this.load()
    const base = input.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'serveur'
    let id = base
    for (let i = 2; list.some((s) => s.id === id); i++) id = `${base}-${i}`
    list.push({ id, label: input.label, command: input.command, args: input.args, enabled: false })
    this.save(list)
  }

  async remove(id: string): Promise<void> {
    await this.disconnect(id)
    this.save(this.load().filter((s) => s.id !== id || s.preset))
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const list = this.load()
    const s = list.find((x) => x.id === id)
    if (!s) throw new Error('Serveur MCP inconnu.')
    s.enabled = enabled
    this.save(list)
    if (enabled) await this.connect(id)
    else await this.disconnect(id)
  }

  /** Connecte au démarrage les serveurs activés (sans bloquer). */
  startEnabled(): void {
    for (const s of this.load()) if (s.enabled) void this.connect(s.id).catch(() => undefined)
  }

  async connect(id: string): Promise<void> {
    if (this.live.has(id)) return
    const pending = this.connecting.get(id)
    if (pending) return pending
    const p = this.doConnect(id).finally(() => this.connecting.delete(id))
    this.connecting.set(id, p)
    return p
  }

  private async doConnect(id: string): Promise<void> {
    const s = this.load().find((x) => x.id === id)
    if (!s) throw new Error('Serveur MCP inconnu.')
    // Préréglage Roblox : chemin recalculé (il dépend du compte Windows).
    const cmd = s.preset === 'roblox' ? robloxCommand() : { command: s.command, args: s.args, found: true, path: s.command }
    if (s.preset === 'roblox' && !cmd.found) {
      const msg = `Serveur MCP de Roblox Studio introuvable (${cmd.path}). Mets Roblox Studio à jour, ouvre-le, puis active « Enable Studio as MCP server » (Assistant > … > Manage MCP Servers).`
      this.errors.set(id, msg)
      throw new Error(msg)
    }
    this.errors.delete(id)
    const transport = new StdioClientTransport({ command: cmd.command, args: cmd.args, stderr: 'pipe' })
    const client = new Client({ name: 'AI Studio', version: '1.0.0' })
    try {
      await client.connect(transport)
      const res = await client.listTools()
      const tools = res.tools.map((t) => ({
        name: t.name,
        description: (t.description ?? '').slice(0, 1000),
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
        readOnly: t.annotations?.readOnlyHint === true || (s.preset === 'roblox' && ROBLOX_READ_ONLY.has(t.name))
      }))
      this.live.set(id, { client, transport, tools })
      transport.onclose = () => {
        this.live.delete(id)
        this.errors.set(id, 'Connexion fermée (application quittée ?). Réactive pour te reconnecter.')
      }
      logActivity(this.db, 'mcp.connected', `MCP connecté : ${s.label} (${tools.length} outil(s))`)
    } catch (e) {
      await transport.close().catch(() => undefined)
      const msg = `${s.label} : connexion MCP impossible (${(e as Error).message}).${s.preset === 'roblox' ? ' Vérifie que Roblox Studio est ouvert et que « Enable Studio as MCP server » est activé.' : ''}`
      this.errors.set(id, msg)
      throw new Error(msg)
    }
  }

  async disconnect(id: string): Promise<void> {
    const l = this.live.get(id)
    this.live.delete(id)
    this.errors.delete(id)
    if (l) await l.client.close().catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.live.keys()].map((id) => this.disconnect(id)))
  }

  /** Outils MCP actuellement disponibles, au format des fournisseurs. */
  specs(): ToolSpec[] {
    const out: ToolSpec[] = []
    for (const [sid, l] of this.live) {
      const label = this.load().find((s) => s.id === sid)?.label ?? sid
      for (const t of l.tools) out.push({ name: toolName(sid, t.name), description: `[${label}] ${t.description}`, parameters: t.inputSchema })
    }
    return out
  }

  connectedLabels(): string[] {
    const list = this.load()
    return [...this.live.keys()].map((id) => list.find((s) => s.id === id)?.label ?? id)
  }

  resolve(name: string): { serverId: string; serverLabel: string; tool: string; readOnly: boolean } | null {
    for (const [sid, l] of this.live) {
      const t = l.tools.find((x) => toolName(sid, x.name) === name)
      if (t) return { serverId: sid, serverLabel: this.load().find((s) => s.id === sid)?.label ?? sid, tool: t.name, readOnly: t.readOnly }
    }
    return null
  }

  async call(serverId: string, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; text: string }> {
    const l = this.live.get(serverId)
    if (!l) throw new Error('Serveur MCP déconnecté.')
    const res = await l.client.callTool({ name: tool, arguments: args }, undefined, { signal, timeout: 180_000 })
    const parts = (res.content as { type: string; text?: string; mimeType?: string }[] | undefined) ?? []
    const text = parts
      .map((p) => (p.type === 'text' ? (p.text ?? '') : p.type === 'image' ? `[image ${p.mimeType ?? ''} reçue, non transmise au modèle]` : `[contenu ${p.type}]`))
      .join('\n')
    return { ok: res.isError !== true, text: text || (res.isError ? 'Erreur sans détail.' : 'OK') }
  }
}
