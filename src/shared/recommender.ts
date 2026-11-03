/**
 * Moteur de recommandation (docs/PHASE1 §2.4). Fonctions pures, testées sur des profils simulés.
 */
import type { HardwareInfo } from './types'
import type { Catalog, ImageEntry, LlmEntry, LlmUse } from './catalog'

export type Fit = 'fast' | 'hybrid' | 'slow' | 'too-heavy'

export interface LlmAssessment {
  id: string
  fit: Fit
  requiredMB: number
  /** Estimation, remplacée par une mesure réelle après installation. */
  tokensPerSecond: number
  reason: string
}

export interface ImageAssessment {
  id: string
  fit: Fit
  reason: string
}

const CONTEXT_FOR_ESTIMATE_K = 8

/** Bande passante mémoire approximative des GPU courants (Go/s). */
const GPU_BANDWIDTH: [RegExp, number][] = [
  [/5090/, 1792], [/5080/, 960], [/5070 ti/, 896], [/5070/, 672], [/5060 ti/, 448], [/5060/, 448],
  [/4090/, 1008], [/4080/, 717], [/4070 ti/, 504], [/4070/, 504], [/4060 ti/, 288], [/4060/, 272], [/4050/, 192],
  [/3090/, 936], [/3080 ti/, 912], [/3080/, 760], [/3070/, 448], [/3060 ti/, 448], [/3060/, 360], [/3050/, 224],
  [/2080/, 448], [/2070/, 448], [/2060/, 336], [/1660/, 192], [/1650/, 128], [/1080/, 320], [/1070/, 256], [/1060/, 192],
  [/7900 xtx/, 960], [/7900/, 800], [/7800/, 624], [/7700/, 432], [/7600/, 288],
  [/9070/, 640], [/9060/, 320],
  [/6950|6900|6800/, 512], [/6750|6700/, 384], [/6650|6600/, 224], [/6500/, 144],
  [/arc.*a770/, 560], [/arc.*a750/, 512], [/arc.*b580/, 456], [/arc.*a380/, 186]
]

export function gpuBandwidthGBs(name: string): number {
  const n = name.toLowerCase()
  for (const [re, bw] of GPU_BANDWIDTH) if (re.test(n)) return bw
  return 250
}

export function ramBandwidthGBs(type?: string): number {
  const t = (type ?? '').toUpperCase()
  if (t.includes('DDR5')) return 70
  if (t.includes('DDR4')) return 40
  return 35
}

/** Mémoire nécessaire : poids + cache KV pour 8k tokens + surcoût du moteur. */
export function llmRequiredMB(m: LlmEntry): number {
  const kvMB = Math.max(256, Math.round(m.paramsB * 48 * (CONTEXT_FOR_ESTIMATE_K / 8)))
  return Math.round(m.sizeMB * 1.05 + kvMB + 400)
}

export function assessLlm(m: LlmEntry, hw: HardwareInfo): LlmAssessment {
  const a = hw.assessment
  const required = llmRequiredMB(m)
  const gpu = a.primaryGpuIndex !== null ? hw.gpus[a.primaryGpuIndex] : undefined
  const gpuBw = gpu && a.accelerator !== 'cpu' ? gpuBandwidthGBs(gpu.name) : 0
  const ramBw = ramBandwidthGBs(hw.memory.type)
  const bitsPerWeight = (m.sizeMB * 8) / (m.paramsB * 1000)
  const gbPerToken = (m.activeParamsB * bitsPerWeight) / 8
  const efficiency = 0.55
  const fmt = (mb: number) => `${(mb / 1024).toFixed(1).replace('.', ',')} Go`

  let fit: Fit
  let tps: number
  let reason: string
  if (a.usableVramMB > 0 && required <= a.usableVramMB) {
    fit = 'fast'
    tps = (gpuBw / gbPerToken) * efficiency
    reason = `Tient entièrement dans la mémoire vidéo (${fmt(required)} sur ${fmt(a.usableVramMB)} utilisables).`
  } else if (required <= a.usableVramMB + a.usableRamMB) {
    if (a.usableVramMB > 0) {
      fit = 'hybrid'
      const fGpu = a.usableVramMB / required
      const time = (fGpu * gbPerToken) / gpuBw + ((1 - fGpu) * gbPerToken) / ramBw
      tps = efficiency / time
      reason = `Nécessite ${fmt(required)} : ${fmt(a.usableVramMB)} sur la carte graphique, le reste en RAM (mode hybride).`
    } else {
      fit = 'slow'
      tps = (ramBw / gbPerToken) * efficiency
      reason = `Fonctionne sur le processeur (${fmt(required)} en RAM).`
    }
  } else {
    fit = 'too-heavy'
    tps = 0
    reason = `Nécessite ${fmt(required)} ; ce PC dispose de ${fmt(a.usableVramMB + a.usableRamMB)} utilisables au total.`
  }
  // Un modèle « rapide » en théorie mais très lent n'est pas présenté comme rapide.
  if (fit === 'hybrid' && tps < 4) fit = 'slow'
  return { id: m.id, fit, requiredMB: required, tokensPerSecond: Math.round(tps), reason }
}

const FIT_FACTOR: Record<Fit, number> = { fast: 1, hybrid: 0.75, slow: 0.35, 'too-heavy': 0 }

export function assessImage(m: ImageEntry, hw: HardwareInfo): ImageAssessment {
  const a = hw.assessment
  const vram = a.usableVramMB + 1228
  if (a.accelerator === 'cpu') {
    return m.minVramMB === 0
      ? { id: m.id, fit: 'slow', reason: 'Fonctionne sur le processeur, mais lentement (plusieurs minutes par image).' }
      : { id: m.id, fit: 'too-heavy', reason: 'Nécessite une carte graphique dédiée.' }
  }
  if (vram >= m.recommendedVramMB) return { id: m.id, fit: 'fast', reason: 'Mémoire vidéo suffisante.' }
  if (vram >= m.minVramMB) return { id: m.id, fit: 'hybrid', reason: 'Fonctionne avec délestage partiel en RAM (plus lent).' }
  return { id: m.id, fit: 'too-heavy', reason: `Nécessite au moins ${Math.round(m.minVramMB / 1024)} Go de mémoire vidéo.` }
}

export interface Recommendation {
  use: LlmUse
  id: string | null
  assessment?: LlmAssessment
}

/** Meilleur modèle par usage pour ce PC. */
export function recommendLlms(catalog: Catalog, hw: HardwareInfo): Recommendation[] {
  const uses: LlmUse[] = ['chat', 'code', 'vision', 'docs']
  return uses.map((use) => {
    let best: { m: LlmEntry; a: LlmAssessment; score: number } | null = null
    for (const m of catalog.llm) {
      const q = m.quality[use]
      if (q === undefined) continue
      if (use === 'vision' && !m.capabilities.includes('vision')) continue
      const a = assessLlm(m, hw)
      let score = q * FIT_FACTOR[a.fit]
      if (use === 'code' && m.capabilities.includes('tools')) score += 0.5
      if (score > 0 && (!best || score > best.score)) best = { m, a, score }
    }
    return { use, id: best?.m.id ?? null, assessment: best?.a }
  })
}

export function recommendImage(catalog: Catalog, hw: HardwareInfo): string | null {
  let best: { id: string; score: number } | null = null
  for (const m of catalog.image) {
    const a = assessImage(m, hw)
    const score = m.quality * FIT_FACTOR[a.fit]
    if (score > 0 && (!best || score > best.score)) best = { id: m.id, score }
  }
  return best?.id ?? null
}
