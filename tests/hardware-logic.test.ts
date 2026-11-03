import { describe, expect, it } from 'vitest'
import {
  assessHardware,
  chooseAccelerator,
  detectVendor,
  isIntegratedGpu,
  parseNvidiaSmi,
  parseRegistryVram
} from '@shared/hardware-logic'
import type { GpuInfo } from '@shared/types'

const GB = 1024
const nv = (name: string, vramMB: number, cc = '8.6'): GpuInfo => ({ name, vendor: 'nvidia', vramMB, vramSource: 'nvidia-smi', integrated: false, computeCapability: cc })
const amd = (name: string, vramMB: number): GpuInfo => ({ name, vendor: 'amd', vramMB, vramSource: 'registry', integrated: false })
const igpu = (name: string, vendor: GpuInfo['vendor']): GpuInfo => ({ name, vendor, vramMB: 0, vramSource: 'unknown', integrated: true })

describe('parseNvidiaSmi', () => {
  it('lit une ou plusieurs cartes', () => {
    const out = 'NVIDIA GeForce RTX 3060 Ti, 8192, 566.36, 8.6\r\nNVIDIA GeForce GTX 1060 6GB, 6144, 566.36, 6.1\r\n'
    const g = parseNvidiaSmi(out)
    expect(g).toHaveLength(2)
    expect(g[0]).toMatchObject({ name: 'NVIDIA GeForce RTX 3060 Ti', vramMB: 8192, computeCapability: '8.6', driverVersion: '566.36' })
    expect(g[1]?.vramMB).toBe(6144)
  })
  it('ignore les lignes invalides', () => {
    expect(parseNvidiaSmi('')).toEqual([])
    expect(parseNvidiaSmi('No devices were found')).toEqual([])
  })
  it('tolère une compute capability absente ([N/A])', () => {
    expect(parseNvidiaSmi('Quadro K2200, 4096, 472.12, [N/A]')[0]?.computeCapability).toBeUndefined()
  })
})

describe('parseRegistryVram', () => {
  it('lit la VRAM réelle au-delà de 4 Go', () => {
    const out = [
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0000',
      '    DriverDesc    REG_SZ    AMD Radeon RX 6700 XT',
      '    HardwareInformation.qwMemorySize    REG_QWORD    0x300000000',
      '',
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0001',
      '    DriverDesc    REG_SZ    Intel(R) UHD Graphics 770',
      '    HardwareInformation.MemorySize    REG_BINARY    0x80000000',
      ''
    ].join('\r\n')
    const r = parseRegistryVram(out)
    expect(r[0]).toEqual({ name: 'AMD Radeon RX 6700 XT', vramMB: 12 * GB })
    expect(r[1]).toEqual({ name: 'Intel(R) UHD Graphics 770', vramMB: 2 * GB })
  })
})

describe('détection du fabricant et des GPU intégrés', () => {
  it('reconnaît les fabricants', () => {
    expect(detectVendor('NVIDIA GeForce RTX 4090')).toBe('nvidia')
    expect(detectVendor('Advanced Micro Devices, Inc. AMD Radeon RX 7800 XT')).toBe('amd')
    expect(detectVendor('Intel(R) Arc(TM) A770 Graphics')).toBe('intel')
  })
  it('distingue intégré et dédié', () => {
    expect(isIntegratedGpu('Intel(R) UHD Graphics 630', 'intel')).toBe(true)
    expect(isIntegratedGpu('Intel(R) Arc(TM) A770 Graphics', 'intel')).toBe(false)
    expect(isIntegratedGpu('AMD Radeon(TM) Graphics', 'amd')).toBe(true)
    expect(isIntegratedGpu('AMD Radeon RX 6600', 'amd')).toBe(false)
  })
})

describe('chooseAccelerator', () => {
  it('CUDA pour NVIDIA récente, Vulkan pour NVIDIA trop ancienne', () => {
    expect(chooseAccelerator(nv('RTX 3060 Ti', 8 * GB))).toBe('cuda')
    expect(chooseAccelerator(nv('GTX 680', 2 * GB, '3.0'))).toBe('vulkan')
  })
  it('Vulkan pour AMD et Intel Arc, CPU sinon', () => {
    expect(chooseAccelerator(amd('RX 6700 XT', 12 * GB))).toBe('vulkan')
    expect(chooseAccelerator(igpu('Intel UHD 620', 'intel'))).toBe('cpu')
    expect(chooseAccelerator(undefined)).toBe('cpu')
  })
})

/** Profils matériels simulés (docs/PHASE2_ARCHITECTURE.md §18.5). */
describe('profils de PC', () => {
  const cases: { name: string; gpus: GpuInfo[]; ram: number; battery?: boolean; tier: number; accel: string; local3D: boolean }[] = [
    { name: 'PC bureautique sans GPU, 8 Go', gpus: [igpu('Intel UHD 620', 'intel')], ram: 8 * GB, tier: 0, accel: 'cpu', local3D: false },
    { name: 'GTX 1060 6 Go, 16 Go', gpus: [nv('GTX 1060 6GB', 6 * GB, '6.1')], ram: 16 * GB, tier: 1, accel: 'cuda', local3D: true },
    { name: 'RTX 3060 Ti 8 Go, 32 Go', gpus: [nv('RTX 3060 Ti', 8 * GB)], ram: 32 * GB, tier: 2, accel: 'cuda', local3D: true },
    { name: 'RX 6700 XT 12 Go, 32 Go', gpus: [amd('AMD Radeon RX 6700 XT', 12 * GB)], ram: 32 * GB, tier: 3, accel: 'vulkan', local3D: false },
    { name: 'RTX 4060 Ti 16 Go, 32 Go', gpus: [nv('RTX 4060 Ti', 16 * GB, '8.9')], ram: 32 * GB, tier: 4, accel: 'cuda', local3D: true },
    { name: 'RTX 4090 24 Go, 64 Go', gpus: [nv('RTX 4090', 24 * GB, '8.9')], ram: 64 * GB, tier: 5, accel: 'cuda', local3D: true },
    { name: 'RTX 4090 24 Go mais 32 Go RAM', gpus: [nv('RTX 4090', 24 * GB, '8.9')], ram: 32 * GB, tier: 4, accel: 'cuda', local3D: true },
    { name: 'Portable iGPU + RTX 4050 6 Go', gpus: [igpu('Intel Iris Xe', 'intel'), nv('RTX 4050 Laptop', 6 * GB, '8.9')], ram: 16 * GB, battery: true, tier: 1, accel: 'cuda', local3D: true },
    { name: 'Intel Arc A770 16 Go', gpus: [{ name: 'Intel Arc A770', vendor: 'intel', vramMB: 16 * GB, vramSource: 'registry', integrated: false }], ram: 32 * GB, tier: 4, accel: 'vulkan', local3D: false }
  ]
  for (const c of cases) {
    it(c.name, () => {
      const a = assessHardware({ gpus: c.gpus, totalRamMB: c.ram, hasBattery: !!c.battery })
      expect(a.tier).toBe(c.tier)
      expect(a.accelerator).toBe(c.accel)
      expect(a.local3D).toBe(c.local3D)
      expect(a.usableVramMB).toBeGreaterThanOrEqual(0)
      expect(a.notes.length).toBeGreaterThan(0)
    })
  }
  it('choisit le GPU dédié plutôt que l’intégré', () => {
    const a = assessHardware({ gpus: [igpu('Intel Iris Xe', 'intel'), nv('RTX 4050 Laptop', 6 * GB)], totalRamMB: 16 * GB, hasBattery: true })
    expect(a.primaryGpuIndex).toBe(1)
    expect(a.notes.some((n) => n.includes('portable'))).toBe(true)
  })
})
