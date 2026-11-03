import { describe, expect, it } from 'vitest'
import { EMBEDDED_CATALOG } from '@shared/catalog'
import { assessHardware } from '@shared/hardware-logic'
import { assessLlm, recommendImage, recommendLlms } from '@shared/recommender'
import type { GpuInfo, HardwareInfo } from '@shared/types'

const GB = 1024
function pc(gpus: GpuInfo[], ramGB: number, memType = 'DDR4'): HardwareInfo {
  const totalRamMB = ramGB * GB
  return {
    os: { platform: 'win32', release: '10.0', arch: 'x64', distro: 'Windows 11' },
    cpu: { brand: 'Test', physicalCores: 6, logicalCores: 12, simd: { avx: true, avx2: true, avx512: false } },
    memory: { totalMB: totalRamMB, type: memType },
    gpus,
    hasBattery: false,
    disk: { dataPath: '/', freeMB: 500 * GB, totalMB: 1000 * GB },
    assessment: assessHardware({ gpus, totalRamMB, hasBattery: false }),
    detectedAt: ''
  }
}
const nv = (name: string, vramGB: number): GpuInfo => ({ name, vendor: 'nvidia', vramMB: vramGB * GB, vramSource: 'nvidia-smi', integrated: false, computeCapability: '8.6' })
const model = (id: string) => EMBEDDED_CATALOG.llm.find((m) => m.id === id)!

describe('recommandeur', () => {
  const rtx3060ti = pc([nv('NVIDIA GeForce RTX 3060 Ti', 8)], 32)
  const office = pc([], 8)
  const rtx4090 = pc([nv('NVIDIA GeForce RTX 4090', 24)], 64, 'DDR5')

  it('RTX 3060 Ti 8 Go : Qwen3 8B rapide, Qwen3-Coder 30B en hybride', () => {
    expect(assessLlm(model('qwen3:8b'), rtx3060ti).fit).toBe('fast')
    const coder = assessLlm(model('qwen3-coder:30b'), rtx3060ti)
    expect(coder.fit).toBe('hybrid')
    expect(coder.tokensPerSecond).toBeGreaterThan(5)
    expect(assessLlm(model('gpt-oss:120b'), rtx3060ti).fit).toBe('too-heavy')
    const recs = recommendLlms(EMBEDDED_CATALOG, rtx3060ti)
    expect(recs.find((r) => r.use === 'code')?.id).toBe('qwen3-coder:30b')
    expect(recommendImage(EMBEDDED_CATALOG, rtx3060ti)).toBe('z-image-turbo')
  })

  it('PC bureautique 8 Go sans GPU : uniquement de petits modèles, jamais « trop lourd » recommandé', () => {
    const recs = recommendLlms(EMBEDDED_CATALOG, office)
    for (const r of recs) {
      if (r.assessment) expect(r.assessment.fit).not.toBe('too-heavy')
    }
    const chat = recs.find((r) => r.use === 'chat')
    expect(chat?.id).toBeTruthy()
    expect(model(chat!.id!).sizeMB).toBeLessThan(4000)
    expect(recommendImage(EMBEDDED_CATALOG, office)).toBe('sd15')
  })

  it('RTX 4090 + 64 Go : modèles lourds accessibles', () => {
    expect(assessLlm(model('gemma3:27b'), rtx4090).fit).toBe('fast')
    expect(assessLlm(model('gpt-oss:120b'), rtx4090).fit).not.toBe('too-heavy')
  })

  it('la vision n’est recommandée qu’avec un modèle qui la gère', () => {
    for (const hw of [rtx3060ti, office, rtx4090]) {
      const v = recommendLlms(EMBEDDED_CATALOG, hw).find((r) => r.use === 'vision')
      if (v?.id) expect(model(v.id).capabilities).toContain('vision')
    }
  })
})
