/**
 * Gestion des modèles locaux (Ollama) : catalogue, installés, chargés,
 * téléchargement avec progression réelle, suppression, capacités vérifiées.
 */
import type { Catalog } from '@shared/catalog'
import { EMBEDDED_CATALOG } from '@shared/catalog'
import type { Db } from './db'
import { logActivity } from './db'
import type { OllamaEngine } from './engines/ollama'
import { taskController, taskUpdate } from './events'
import { latestGithubRelease, readNdjson, USER_AGENT } from './net'

export interface InstalledModel {
  name: string
  sizeMB: number
  modifiedAt: string
  family?: string
  parameterSize?: string
  quantization?: string
}

export interface LoadedModel {
  name: string
  sizeMB: number
  vramMB: number
  expiresAt?: string
}

export interface ModelCapabilities {
  tools: boolean
  vision: boolean
  thinking: boolean
  contextK?: number
}

const CATALOG_URL = 'https://raw.githubusercontent.com/YutsiOFF/ai-studio/main/catalog/catalog.json'

function isCloudModel(name: string, remote?: unknown): boolean {
  return Boolean(remote) || /(^|[:-])cloud($|[:-])/.test(name)
}

export class LocalModels {
  private catalogCache: Catalog = EMBEDDED_CATALOG
  private catalogFetched = false
  private capsCache = new Map<string, ModelCapabilities>()
  private engineSizeMB: number | undefined

  constructor(
    private readonly db: Db,
    private readonly ollama: OllamaEngine
  ) {}

  /** Catalogue : version publiée sur GitHub si plus récente, sinon version embarquée (hors ligne). */
  async catalog(): Promise<Catalog> {
    if (!this.catalogFetched) {
      this.catalogFetched = true
      try {
        const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': USER_AGENT } })
        if (res.ok) {
          const remote = (await res.json()) as Catalog
          if (typeof remote.version === 'number' && remote.version > this.catalogCache.version && Array.isArray(remote.llm) && Array.isArray(remote.image)) {
            this.catalogCache = remote
          }
        }
      } catch {
        /* hors ligne : catalogue embarqué */
      }
    }
    return this.catalogCache
  }

  async engineStatus() {
    const s = await this.ollama.status()
    if (!s.installed && this.engineSizeMB === undefined && process.platform === 'win32') {
      try {
        const rel = await latestGithubRelease('ollama/ollama')
        const a = rel.assets.find((x) => x.name === (process.arch === 'arm64' ? 'ollama-windows-arm64.zip' : 'ollama-windows-amd64.zip'))
        this.engineSizeMB = a ? Math.round(a.size / (1024 * 1024)) : undefined
      } catch {
        /* inconnu */
      }
    }
    return { ...s, downloadSizeMB: this.engineSizeMB }
  }

  async installed(): Promise<InstalledModel[]> {
    const url = await this.ollama.ensureRunning()
    const res = await fetch(`${url}/api/tags`)
    if (!res.ok) throw new Error(`Moteur local : HTTP ${res.status}`)
    const json = (await res.json()) as {
      models: { name: string; size: number; modified_at: string; remote_host?: string; details?: { family?: string; parameter_size?: string; quantization_level?: string } }[]
    }
    return json.models
      .filter((m) => !isCloudModel(m.name, m.remote_host))
      .map((m) => ({
        name: m.name,
        sizeMB: Math.round(m.size / (1024 * 1024)),
        modifiedAt: m.modified_at,
        family: m.details?.family,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level
      }))
  }

  async loaded(): Promise<LoadedModel[]> {
    const s = await this.ollama.status()
    if (!s.running || !s.baseUrl) return []
    const res = await fetch(`${s.baseUrl}/api/ps`)
    if (!res.ok) return []
    const json = (await res.json()) as { models: { name: string; size: number; size_vram: number; expires_at?: string }[] }
    return json.models.map((m) => ({
      name: m.name,
      sizeMB: Math.round(m.size / (1024 * 1024)),
      vramMB: Math.round(m.size_vram / (1024 * 1024)),
      expiresAt: m.expires_at
    }))
  }

  /** Capacités réelles rapportées par le moteur (pas celles annoncées par le catalogue). */
  async capabilities(model: string): Promise<ModelCapabilities> {
    const cached = this.capsCache.get(model)
    if (cached) return cached
    const url = await this.ollama.ensureRunning()
    const res = await fetch(`${url}/api/show`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }) })
    if (!res.ok) throw new Error(`Modèle ${model} introuvable dans le moteur local.`)
    const json = (await res.json()) as { capabilities?: string[]; model_info?: Record<string, unknown> }
    const caps = json.capabilities ?? []
    const ctxKey = Object.keys(json.model_info ?? {}).find((k) => k.endsWith('.context_length'))
    const ctx = ctxKey ? Number(json.model_info?.[ctxKey]) : undefined
    const result = {
      tools: caps.includes('tools'),
      vision: caps.includes('vision'),
      thinking: caps.includes('thinking'),
      contextK: ctx ? Math.round(ctx / 1000) : undefined
    }
    this.capsCache.set(model, result)
    return result
  }

  /** Taille exacte d'un modèle d'après le registre Ollama (sans compte). */
  async registrySizeMB(tag: string): Promise<number | null> {
    const [nameRaw, version = 'latest'] = tag.split(':')
    const name = nameRaw!.includes('/') ? nameRaw : `library/${nameRaw}`
    try {
      const res = await fetch(`https://registry.ollama.ai/v2/${name}/manifests/${version}`, {
        headers: { Accept: 'application/vnd.docker.distribution.manifest.v2+json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(8000)
      })
      if (!res.ok) return null
      const m = (await res.json()) as { layers?: { size: number }[]; config?: { size: number } }
      const total = (m.layers ?? []).reduce((s, l) => s + l.size, 0) + (m.config?.size ?? 0)
      return Math.round(total / (1024 * 1024))
    } catch {
      return null
    }
  }

  async pull(tag: string): Promise<void> {
    const id = `model:${tag}`
    const label = `Téléchargement de ${tag}`
    const ctrl = taskController(id)
    taskUpdate({ id, kind: 'model', label, state: 'running', stage: 'Connexion au registre' })
    try {
      const url = await this.ollama.ensureRunning()
      const res = await fetch(`${url}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: tag, stream: true }),
        signal: ctrl.signal
      })
      if (!res.ok || !res.body) throw new Error(`Le moteur a refusé le téléchargement (HTTP ${res.status}).`)
      const layers = new Map<string, { total: number; completed: number }>()
      let last = 0
      let lastBytes = 0
      let speed = 0
      for await (const ev of readNdjson<{ status?: string; digest?: string; total?: number; completed?: number; error?: string }>(res.body)) {
        if (ev.error) throw new Error(ev.error)
        if (ev.digest && ev.total) layers.set(ev.digest, { total: ev.total, completed: ev.completed ?? 0 })
        const total = [...layers.values()].reduce((s, l) => s + l.total, 0)
        const received = [...layers.values()].reduce((s, l) => s + l.completed, 0)
        const now = Date.now()
        if (now - last > 400) {
          if (last) {
            const inst = ((received - lastBytes) * 1000) / (now - last)
            speed = speed ? speed * 0.7 + inst * 0.3 : inst
          }
          last = now
          lastBytes = received
          taskUpdate({ id, kind: 'model', label, state: 'running', stage: translateStatus(ev.status), received, total, speed: Math.max(0, speed) })
        }
        if (ev.status === 'success') break
      }
      this.capsCache.delete(tag)
      logActivity(this.db, 'model.installed', `Modèle local ${tag} installé`)
      taskUpdate({ id, kind: 'model', label, state: 'done', stage: 'Installé' })
    } catch (e) {
      const cancelled = ctrl.signal.aborted
      taskUpdate({ id, kind: 'model', label, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : (e as Error).message })
      if (!cancelled) throw e
    }
  }

  async remove(tag: string): Promise<void> {
    const url = await this.ollama.ensureRunning()
    const res = await fetch(`${url}/api/delete`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: tag }) })
    if (!res.ok) throw new Error(`Suppression impossible (HTTP ${res.status}).`)
    this.capsCache.delete(tag)
    logActivity(this.db, 'model.removed', `Modèle local ${tag} supprimé`)
  }

  /** Libère la mémoire vidéo occupée par un modèle (sans le supprimer). */
  async unload(tag: string): Promise<void> {
    const s = await this.ollama.status()
    if (!s.running || !s.baseUrl) return
    await fetch(`${s.baseUrl}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: tag, keep_alive: 0 }) })
  }

  async unloadAll(): Promise<void> {
    for (const m of await this.loaded()) await this.unload(m.name)
  }

  recordSpeed(model: string, tps: number): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(`tps:${model}`, String(Math.round(tps * 10) / 10))
  }

  measuredSpeeds(): Record<string, number> {
    const rows = this.db.prepare("SELECT key, value FROM settings WHERE key LIKE 'tps:%'").all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map((r) => [r.key.slice(4), Number(r.value)]))
  }
}

function translateStatus(s?: string): string {
  if (!s) return 'Téléchargement'
  if (s.startsWith('pulling manifest')) return 'Lecture du manifeste'
  if (s.startsWith('pulling')) return 'Téléchargement des fichiers du modèle'
  if (s.startsWith('verifying')) return 'Vérification de l’intégrité'
  if (s.startsWith('writing')) return 'Écriture du manifeste'
  if (s === 'success') return 'Terminé'
  return s
}
