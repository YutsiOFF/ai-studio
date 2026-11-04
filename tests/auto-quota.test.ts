import { describe, expect, it } from 'vitest'
import { modelScore, rankCandidates, type AutoCandidate } from '@shared/auto-router'
import { parseQuotaError } from '@shared/quota'
import { AutoProvider } from '../src/main/providers/auto'
import type { LlmProvider, StreamEvent } from '../src/main/providers/types'
import { LOCAL3D_SPECS, patchTripoSGInferenceUtils } from '../src/main/local3d-spec'

const cand = (provider: string, model: string, extra: Partial<AutoCandidate> = {}): AutoCandidate => ({
  provider,
  providerLabel: provider.toUpperCase(),
  model,
  score: modelScore(model),
  tools: true,
  vision: null,
  ...extra
})

describe('routeur Auto', () => {
  it('classe les gros modèles avant les petits', () => {
    expect(modelScore('Qwen3.5-397B-A17B')).toBeGreaterThan(modelScore('gpt-oss-120b'))
    expect(modelScore('gpt-oss-120b')).toBeGreaterThan(modelScore('gpt-oss-20b'))
    expect(modelScore('DeepSeek-V4-Flash-0731')).toBeGreaterThan(modelScore('Meta-Llama-3_3-70B-Instruct'))
  })

  it('alterne les fournisseurs à score proche et met en fin ceux en pause', () => {
    const list = [cand('ovh', 'Qwen3.5-397B-A17B'), cand('ovh', 'gpt-oss-120b'), cand('kilo', 'reflection/beam-free'), cand('llm7', 'GLM-5.3-Flash')]
    const now = 1000
    const r = rankCandidates(list, { tools: false, vision: false }, (c) => (c.model === 'reflection/beam-free' ? 5000 : 0), now)
    expect(r[0]!.model).toBe('Qwen3.5-397B-A17B')
    expect(r[1]!.provider).not.toBe('ovh')
    expect(r[r.length - 1]!.model).toBe('reflection/beam-free')
  })

  it('exclut les modèles sans outils en mode agent et sans vision pour les images', () => {
    const list = [cand('a', 'gpt-oss-120b', { tools: false }), cand('b', 'qwen2.5-vl-72b', { vision: true })]
    expect(rankCandidates(list, { tools: true, vision: false }, () => 0).map((c) => c.provider)).toEqual(['b'])
    expect(rankCandidates(list, { tools: false, vision: true }, () => 0).map((c) => c.provider)).toEqual(['b'])
  })

  it('bascule sur le modèle suivant après un 429, sans doublon de texte', async () => {
    const calls: string[] = []
    const make = (fail: boolean): LlmProvider => ({
      location: 'cloud',
      async *chat(req) {
        calls.push(req.model)
        if (fail) throw new Error('OVH : quota gratuit atteint (429).')
        yield { type: 'text', text: 'bonjour' } as StreamEvent
        yield { type: 'done', reason: 'stop' } as StreamEvent
      }
    })
    const auto = new AutoProvider({
      candidates: async () => [cand('ovh', 'Qwen3.5-397B-A17B'), cand('kilo', 'reflection/beam-free')],
      provider: (id) => make(id === 'ovh')
    })
    const events: StreamEvent[] = []
    for await (const ev of auto.chat({ model: 'auto', messages: [{ role: 'user', content: 'salut' }] }, new AbortController().signal)) events.push(ev)
    expect(calls).toEqual(['Qwen3.5-397B-A17B', 'reflection/beam-free'])
    expect(events.filter((e) => e.type === 'text')).toHaveLength(1)
    expect(events.some((e) => e.type === 'route-fail')).toBe(true)
    const last = [...events].reverse().find((e) => e.type === 'route')
    expect(last).toMatchObject({ provider: 'kilo' })
  })
})

describe('quota ZeroGPU', () => {
  it('lit les secondes restantes et l’heure de réinitialisation', () => {
    const now = Date.parse('2026-11-04T10:00:00Z')
    const q = parseQuotaError('You have exceeded your GPU quota (90s requested vs. 57s left). Try again in 1:30:00', true, now)!
    expect(q.leftSeconds).toBe(57)
    expect(q.requestedSeconds).toBe(90)
    expect(q.resetAt).toBe('2026-11-04T11:30:00.000Z')
    expect(parseQuotaError('Connection refused', false)).toBeNull()
  })
})

describe('recettes 3D locales', () => {
  it('rend TripoSG utilisable sans diso et sans CUDA codé en dur', () => {
    const src = [
      'import torch',
      'from diso import DiffDMC',
      'def expand_edge_region_fast(edge_coords, grid_size):',
      "    expanded_tensor = torch.zeros(grid_size, grid_size, grid_size, device='cuda', dtype=torch.float16, requires_grad=False)",
      '    return expanded_tensor.to(torch.float16)'
    ].join('\n')
    const out = patchTripoSGInferenceUtils(src)
    expect(out).toContain('DiffDMC = None')
    expect(out).toContain('device=edge_coords.device')
    expect(out).not.toMatch(/device='cuda'/)
    expect(out).not.toMatch(/torch\.float16\)/)
    expect(out).toContain('_HALF = torch.float16 if torch.cuda.is_available() else torch.float32')
  })

  it('épingle toutes les dépendances', () => {
    for (const spec of Object.values(LOCAL3D_SPECS)) {
      for (const d of [...spec.deps, ...spec.torch]) expect(d).toMatch(/==/)
      expect(spec.sourceZip).toMatch(/\/zip\/[0-9a-f]{40}$/)
    }
  })
})
