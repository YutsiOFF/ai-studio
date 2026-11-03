/**
 * Détection matérielle réelle. Les décisions sont prises par la logique pure
 * de @shared/hardware-logic (testée sur des profils simulés).
 */
import { execFile } from 'node:child_process'
import { statfsSync } from 'node:fs'
import os from 'node:os'
import si from 'systeminformation'
import {
  assessHardware,
  detectVendor,
  isIntegratedGpu,
  parseNvidiaSmi,
  parseRegistryVram
} from '@shared/hardware-logic'
import type { GpuInfo, HardwareInfo, ResourceUsage } from '@shared/types'

const DISPLAY_CLASS_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}'

function run(cmd: string, args: string[], timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout.toString())
    })
  })
}

async function nvidiaSmi(query: string): Promise<string | null> {
  return run('nvidia-smi', [`--query-gpu=${query}`, '--format=csv,noheader,nounits'])
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/\(r\)|\(tm\)|nvidia|amd|intel|\s+/g, '')
}

function diskInfo(path: string): { freeMB: number; totalMB: number } {
  try {
    const s = statfsSync(path)
    return {
      freeMB: Math.round((s.bavail * s.bsize) / (1024 * 1024)),
      totalMB: Math.round((s.blocks * s.bsize) / (1024 * 1024))
    }
  } catch {
    return { freeMB: 0, totalMB: 0 }
  }
}

async function detectGpus(): Promise<GpuInfo[]> {
  const [smiOut, regOut, graphics] = await Promise.all([
    nvidiaSmi('name,memory.total,driver_version,compute_cap'),
    process.platform === 'win32' ? run('reg', ['query', DISPLAY_CLASS_KEY, '/s']) : Promise.resolve(null),
    si.graphics().catch(() => ({ controllers: [] as si.Systeminformation.GraphicsControllerData[] }))
  ])

  const nvidia = smiOut ? parseNvidiaSmi(smiOut) : []
  const registry = regOut ? parseRegistryVram(regOut) : []
  const gpus: GpuInfo[] = []
  const usedNvidia = new Set<number>()

  for (const c of graphics.controllers) {
    const name = (c.model || c.name || '').trim()
    if (!name || /basic display|microsoft basic|remote display|virtual/i.test(name)) continue
    const vendor = detectVendor(`${c.vendor ?? ''} ${name}`)

    if (vendor === 'nvidia') {
      const idx = nvidia.findIndex((g, i) => !usedNvidia.has(i) && normalize(g.name) === normalize(name))
      const fallbackIdx = idx >= 0 ? idx : nvidia.findIndex((_, i) => !usedNvidia.has(i))
      if (fallbackIdx >= 0) {
        usedNvidia.add(fallbackIdx)
        gpus.push(nvidia[fallbackIdx]!)
        continue
      }
    }

    const reg = registry.find((r) => normalize(r.name) === normalize(name))
    const integrated = isIntegratedGpu(name, vendor) || c.vramDynamic === true
    const sysVram = typeof c.vram === 'number' ? c.vram : 0
    gpus.push({
      name,
      vendor,
      vramMB: integrated ? 0 : reg?.vramMB ?? sysVram,
      vramSource: integrated ? 'unknown' : reg ? 'registry' : sysVram > 0 ? 'system' : 'unknown',
      integrated,
      driverVersion: c.driverVersion || undefined
    })
  }

  // GPU NVIDIA visibles par nvidia-smi mais absents de la liste système.
  nvidia.forEach((g, i) => {
    if (!usedNvidia.has(i)) gpus.push(g)
  })
  return gpus
}

let cache: HardwareInfo | null = null

export async function getHardware(dataPath: string, refresh = false): Promise<HardwareInfo> {
  if (cache && !refresh) return cache
  const [cpu, flags, mem, memLayout, osInfo, battery, gpus] = await Promise.all([
    si.cpu(),
    si.cpuFlags().catch(() => ''),
    si.mem(),
    si.memLayout().catch(() => [] as si.Systeminformation.MemLayoutData[]),
    si.osInfo(),
    si.battery().catch(() => ({ hasBattery: false }) as si.Systeminformation.BatteryData),
    detectGpus()
  ])
  const f = ` ${flags.toLowerCase()} `
  const totalRamMB = Math.round(mem.total / (1024 * 1024))
  const memType = memLayout.find((m) => m.type && m.type !== 'Unknown')?.type

  cache = {
    os: { platform: osInfo.platform, release: osInfo.release, arch: os.arch(), distro: osInfo.distro },
    cpu: {
      brand: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      physicalCores: cpu.physicalCores,
      logicalCores: cpu.cores,
      simd: { avx: f.includes(' avx '), avx2: f.includes(' avx2 '), avx512: /avx512/.test(f) }
    },
    memory: { totalMB: totalRamMB, type: memType },
    gpus,
    hasBattery: battery.hasBattery,
    disk: { dataPath, ...diskInfo(dataPath) },
    assessment: assessHardware({ gpus, totalRamMB, hasBattery: battery.hasBattery }),
    detectedAt: new Date().toISOString()
  }
  return cache
}

export async function getUsage(dataPath: string): Promise<ResourceUsage> {
  const [load, mem, smi] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    nvidiaSmi('name,memory.used,memory.total,utilization.gpu')
  ])
  const gpus: ResourceUsage['gpus'] = []
  for (const line of (smi ?? '').split(/\r?\n/)) {
    const [name, used, total, util] = line.split(',').map((s) => s.trim())
    if (!name || !used || !total) continue
    gpus.push({
      name,
      vramUsedMB: Number.parseInt(used, 10) || 0,
      vramTotalMB: Number.parseInt(total, 10) || 0,
      utilizationPercent: Number.parseInt(util ?? '0', 10) || 0
    })
  }
  return {
    cpuLoadPercent: Math.round(load.currentLoad),
    memUsedMB: Math.round(mem.active / (1024 * 1024)),
    memTotalMB: Math.round(mem.total / (1024 * 1024)),
    gpus,
    disk: diskInfo(dataPath),
    sampledAt: new Date().toISOString()
  }
}
