/**
 * Fournisseurs Cloud : clés chiffrées par Windows (DPAPI via safeStorage),
 * compteur de requêtes quotidien, liste des modèles gratuits.
 */
import { safeStorage } from 'electron'
import { CLOUD_PROVIDERS, type CloudProvider } from '@shared/providers'
import { logActivity, type Db } from './db'
import { OpenAICompatProvider } from './providers/openai'
import type { ModelInfo } from './providers/types'

export interface ProviderState {
  id: string
  configured: boolean
  enabled: boolean
  extra: Record<string, string>
  requestsToday: number
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export class CloudProviders {
  private modelsCache = new Map<string, { at: number; models: ModelInfo[] }>()
  constructor(private readonly db: Db) {}

  config(id: string): CloudProvider {
    const p = CLOUD_PROVIDERS.find((x) => x.id === id)
    if (!p) throw new Error(`Fournisseur inconnu : ${id}`)
    return p
  }

  states(): ProviderState[] {
    const rows = this.db.prepare('SELECT provider_id, enc, extra, enabled FROM provider_keys').all() as {
      provider_id: string
      enc: string | null
      extra: string
      enabled: number
    }[]
    const usage = this.db.prepare('SELECT provider_id, requests FROM usage_daily WHERE day = ?').all(today()) as { provider_id: string; requests: number }[]
    return CLOUD_PROVIDERS.map((p) => {
      const r = rows.find((x) => x.provider_id === p.id)
      return {
        id: p.id,
        configured: p.keyRequired ? Boolean(r?.enc) : true,
        enabled: r ? r.enabled === 1 : !p.keyRequired,
        extra: r ? (JSON.parse(r.extra) as Record<string, string>) : {},
        requestsToday: usage.find((u) => u.provider_id === p.id)?.requests ?? 0
      }
    })
  }

  setKey(id: string, key: string, extra: Record<string, string>): void {
    const p = this.config(id)
    const trimmed = key.trim()
    let enc: string | null = null
    if (trimmed) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Le chiffrement sécurisé de Windows n'est pas disponible : la clé n'a pas été enregistrée.")
      enc = safeStorage.encryptString(trimmed).toString('base64')
    }
    this.db
      .prepare(
        'INSERT INTO provider_keys (provider_id, enc, extra, enabled) VALUES (?, ?, ?, 1) ON CONFLICT(provider_id) DO UPDATE SET enc = COALESCE(excluded.enc, provider_keys.enc), extra = excluded.extra, enabled = 1'
      )
      .run(id, enc, JSON.stringify(extra))
    this.modelsCache.delete(id)
    logActivity(this.db, 'cloud.configured', `Fournisseur Cloud ${p.label} configuré`)
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare('INSERT INTO provider_keys (provider_id, enc, extra, enabled) VALUES (?, NULL, ?, ?) ON CONFLICT(provider_id) DO UPDATE SET enabled = excluded.enabled')
      .run(id, '{}', enabled ? 1 : 0)
  }

  removeKey(id: string): void {
    this.db.prepare('DELETE FROM provider_keys WHERE provider_id = ?').run(id)
    this.modelsCache.delete(id)
    logActivity(this.db, 'cloud.removed', `Clé du fournisseur ${this.config(id).label} supprimée`)
  }

  private secret(id: string): { key: string | null; extra: Record<string, string> } {
    const row = this.db.prepare('SELECT enc, extra FROM provider_keys WHERE provider_id = ?').get(id) as { enc: string | null; extra: string } | undefined
    const key = row?.enc ? safeStorage.decryptString(Buffer.from(row.enc, 'base64')) : null
    return { key, extra: row ? (JSON.parse(row.extra) as Record<string, string>) : {} }
  }

  provider(id: string): OpenAICompatProvider {
    const cfg = this.config(id)
    const { key, extra } = this.secret(id)
    if (cfg.keyRequired && !key) throw new Error(`${cfg.label} n'est pas configuré : ajoute une clé dans Paramètres > IA.`)
    return new OpenAICompatProvider(cfg, key, extra, () => {
      this.db
        .prepare('INSERT INTO usage_daily (provider_id, day, requests) VALUES (?, ?, 1) ON CONFLICT(provider_id, day) DO UPDATE SET requests = requests + 1')
        .run(id, today())
    })
  }

  async models(id: string, refresh = false): Promise<ModelInfo[]> {
    const c = this.modelsCache.get(id)
    if (c && !refresh && Date.now() - c.at < 10 * 60_000) return c.models
    const models = await this.provider(id).listModels()
    this.modelsCache.set(id, { at: Date.now(), models })
    return models
  }

  /** Jeton Hugging Face facultatif (compte gratuit : quota GPU 3D plus élevé). */
  setHfToken(token: string): void {
    const t = token.trim()
    if (!t) {
      this.db.prepare("DELETE FROM provider_keys WHERE provider_id = '__huggingface'").run()
      return
    }
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(t)) throw new Error('Jeton Hugging Face invalide (il commence par hf_).')
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Le chiffrement sécurisé de Windows n'est pas disponible.")
    this.db
      .prepare("INSERT INTO provider_keys (provider_id, enc, extra, enabled) VALUES ('__huggingface', ?, '{}', 1) ON CONFLICT(provider_id) DO UPDATE SET enc = excluded.enc")
      .run(safeStorage.encryptString(t).toString('base64'))
  }

  hfToken(): string | undefined {
    return this.secret('__huggingface').key ?? undefined
  }

  /** Vérifie réellement la connexion (liste des modèles). */
  async test(id: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
    try {
      const m = await this.models(id, true)
      return { ok: true, count: m.length }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
}
