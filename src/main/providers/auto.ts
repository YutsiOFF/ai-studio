/** Fournisseur virtuel « Auto » : essaie les meilleurs modèles gratuits, bascule en cas de saturation. */
import { rankCandidates, type AutoCandidate } from '@shared/auto-router'
import type { ChatRequest, LlmProvider, StreamEvent } from './types'

export interface AutoSource {
  candidates(): Promise<AutoCandidate[]>
  provider(id: string): LlmProvider
}

const cooldown = new Map<string, number>()
const key = (c: AutoCandidate) => `${c.provider}|${c.model}`

/** Nombre maximal de modèles essayés pour une seule réponse. */
const MAX_TRIES = 6

export class AutoProvider implements LlmProvider {
  location = 'cloud' as const
  /** Modèle qui a répondu au tour précédent : réutilisé en priorité pour rester cohérent pendant une tâche. */
  private sticky: AutoCandidate | null = null
  constructor(private readonly src: AutoSource) {}

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    const need = { tools: Boolean(req.tools?.length), vision: req.messages.some((m) => m.images?.length) }
    let list = rankCandidates(await this.src.candidates(), need, (c) => cooldown.get(key(c)) ?? 0)
    const sticky = this.sticky
    if (sticky && (cooldown.get(key(sticky)) ?? 0) <= Date.now()) {
      const i = list.findIndex((c) => key(c) === key(sticky))
      if (i > 0) list = [list[i]!, ...list.slice(0, i), ...list.slice(i + 1)]
    }
    if (!list.length) {
      throw new Error(
        need.vision
          ? 'Aucun modèle Cloud gratuit compatible avec les images n’est disponible pour le moment.'
          : 'Aucun fournisseur Cloud gratuit n’est disponible. Vérifie ta connexion Internet ou active un fournisseur dans Paramètres > IA.'
      )
    }
    const failures: string[] = []
    for (const c of list.slice(0, MAX_TRIES)) {
      if (signal.aborted) return
      yield { type: 'route', provider: c.provider, providerLabel: c.providerLabel, model: c.model }
      let started = false
      try {
        for await (const ev of this.src.provider(c.provider).chat({ ...req, model: c.model }, signal)) {
          if (ev.type === 'text' || ev.type === 'reasoning' || ev.type === 'tool-call') started = true
          yield ev
        }
        cooldown.delete(key(c))
        this.sticky = c
        return
      } catch (e) {
        // Une réponse déjà commencée ne peut pas être reprise ailleurs sans doublon.
        if (signal.aborted || started) throw e
        const msg = (e as Error).message
        const limited = /429|quota|rate|limit|saturé/i.test(msg)
        cooldown.set(key(c), Date.now() + (limited ? 65_000 : 5 * 60_000))
        failures.push(`${c.providerLabel} (${c.model})`)
        yield { type: 'route-fail', text: `${c.providerLabel} · ${c.model} ${limited ? 'saturé' : 'indisponible'} : modèle suivant` }
      }
    }
    throw new Error(`Tous les modèles gratuits essayés sont saturés pour l’instant (${failures.join(', ')}). Réessaie dans une minute, ou utilise un modèle local.`)
  }
}
