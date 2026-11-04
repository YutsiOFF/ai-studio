/**
 * Routeur « Auto » : choisit le meilleur modèle Cloud gratuit disponible et bascule
 * automatiquement sur le suivant quand un fournisseur est saturé (429), en panne ou lent.
 * Les fournisseurs sans clé limitent chacun leurs requêtes ; les enchaîner multiplie
 * le débit réel sans dépasser aucune limite.
 */

export const AUTO_PROVIDER = 'auto'
/** Référence de modèle du routeur Auto (format refToString). */
export const AUTO_REF = 'cloud|auto|auto'

/** Puissance estimée d'après le nom (plus haut = meilleur). Les noms inconnus restent au milieu. */
const RULES: [RegExp, number][] = [
  [/claude|gpt-5|gpt-6|gemini-(3|4)|grok-4/, 97],
  [/qwen3\.5-397b|qwen3-235b|qwen3-coder-480b/, 95],
  [/deepseek-v4(?!.*flash)|deepseek-r1(?!.*distill)|deepseek-v3/, 94],
  [/kimi-k(2|3)|glm-5(?!.*flash)|minimax-m3(?!.*flash)/, 93],
  [/beam/, 92],
  [/deepseek-v4.*flash|glm-5.*flash|minimax/, 88],
  [/crouton|mimo-v2\.6-pro|mistral-large|llama-4-maverick/, 87],
  [/gpt-oss-120b|gpt-oss:120b/, 86],
  [/nemotron-3(\.5)?-super|nemotron.*ultra/, 85],
  [/kilo-auto/, 82],
  [/qwen3\.[5-9]-27b|qwen3\.[5-9]-32b|qwen3-32b|qwen2\.5-vl-72b|qwen2\.5-72b/, 80],
  [/llama-3[._]3-70b|llama-3\.1-70b|llama-4/, 76],
  [/gemma-?4|gemma-3-27b|mistral-small|codestral|devstral/, 72],
  [/gpt-oss-20b|gpt-oss:20b|nemotron.*nano|glyph/, 64],
  [/mistral-nemo|qwen3\.5-9b|llama-3\.1-8b|8b|9b/, 50]
]

export function modelScore(id: string): number {
  const s = id.toLowerCase()
  for (const [re, v] of RULES) if (re.test(s)) return v
  return 60
}

export interface AutoCandidate {
  provider: string
  providerLabel: string
  model: string
  score: number
  tools: boolean | null
  vision: boolean | null
}

/**
 * Classe les candidats : meilleur score d'abord, en alternant les fournisseurs à score
 * proche pour qu'un fournisseur saturé ne bloque pas plusieurs essais d'affilée.
 */
export function rankCandidates(all: AutoCandidate[], need: { tools: boolean; vision: boolean }, coolingUntil: (c: AutoCandidate) => number, now = Date.now()): AutoCandidate[] {
  const ok = all.filter((c) => (!need.tools || c.tools !== false) && (!need.vision || c.vision === true))
  const scored = ok.map((c) => ({ c, s: c.score + (need.tools && c.tools === true ? 3 : 0) }))
  scored.sort((a, b) => b.s - a.s)
  const ready = scored.filter((x) => coolingUntil(x.c) <= now).map((x) => x.c)
  const cooling = scored.filter((x) => coolingUntil(x.c) > now).sort((a, b) => coolingUntil(a.c) - coolingUntil(b.c)).map((x) => x.c)
  // Alternance : on évite deux essais consécutifs chez le même fournisseur quand c'est possible.
  const out: AutoCandidate[] = []
  const rest = [...ready]
  while (rest.length) {
    const last = out[out.length - 1]
    const best = rest[0]!
    const i = last && best.provider === last.provider ? rest.findIndex((c) => c.provider !== last.provider && best.score - c.score <= 8) : 0
    out.push(rest.splice(i < 0 ? 0 : i, 1)[0]!)
  }
  return [...out, ...cooling]
}
