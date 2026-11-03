/**
 * Logique matérielle pure (sans E/S), testée sur des profils de PC simulés.
 * Voir docs/PHASE2_ARCHITECTURE.md §18.
 */
import type { Accelerator, GpuInfo, GpuVendor, HardwareAssessment } from './types'

/** Marge de VRAM laissée à Windows et aux autres applications. */
export const VRAM_SYSTEM_RESERVE_MB = 1228
/** Marge de RAM laissée au système. */
export const RAM_SYSTEM_RESERVE_MB = 4096
/** Compute capability CUDA minimale prise en charge (à confirmer avec le moteur embarqué). */
export const MIN_CUDA_COMPUTE = 5.0
/** VRAM minimale pour le générateur 3D local le plus léger (TripoSR). */
export const MIN_VRAM_LOCAL_3D_MB = 6 * 1024

export function detectVendor(text: string): GpuVendor {
  const t = text.toLowerCase()
  if (t.includes('nvidia') || t.includes('geforce') || t.includes('quadro') || /\brtx\b/.test(t)) return 'nvidia'
  if (t.includes('amd') || t.includes('radeon') || t.includes('advanced micro devices') || t.includes('ati ')) return 'amd'
  if (t.includes('intel')) return 'intel'
  if (t.includes('apple')) return 'apple'
  return 'other'
}

/** Heuristique : GPU intégré au processeur (pas de mémoire dédiée significative). */
export function isIntegratedGpu(name: string, vendor: GpuVendor): boolean {
  const n = name.toLowerCase()
  if (vendor === 'intel') return !n.includes('arc')
  if (vendor === 'amd') {
    // Radeon dédiées : "RX ####", "Radeon Pro", "Vega 56/64", "Radeon VII"
    if (/\brx\s?\d{3,4}/.test(n) || n.includes('radeon pro') || /vega\s?(56|64)/.test(n) || n.includes('radeon vii')) return false
    return true
  }
  if (vendor === 'apple') return true
  return false
}

/**
 * Analyse la sortie de :
 * nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader,nounits
 */
export function parseNvidiaSmi(output: string): GpuInfo[] {
  const gpus: GpuInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    const parts = line.split(',').map((p) => p.trim())
    if (parts.length < 2 || !parts[0]) continue
    const vram = Number.parseInt(parts[1] ?? '', 10)
    if (!Number.isFinite(vram)) continue
    const cc = parts[3] && /^\d+(\.\d+)?$/.test(parts[3]) ? parts[3] : undefined
    gpus.push({
      name: parts[0],
      vendor: 'nvidia',
      vramMB: vram,
      vramSource: 'nvidia-smi',
      integrated: false,
      driverVersion: parts[2] || undefined,
      computeCapability: cc
    })
  }
  return gpus
}

/**
 * Analyse la sortie de `reg query <classe des adaptateurs d'affichage> /s`
 * pour obtenir la VRAM réelle (HardwareInformation.qwMemorySize), car
 * Win32_VideoController.AdapterRAM est plafonné à 4 Go.
 */
export function parseRegistryVram(output: string): { name: string; vramMB: number }[] {
  const result: { name: string; vramMB: number }[] = []
  const blocks = output.split(/\r?\n(?=HKEY_)/)
  for (const block of blocks) {
    const desc = /DriverDesc\s+REG_SZ\s+(.+)/.exec(block)?.[1]?.trim()
    const qw = /HardwareInformation\.qwMemorySize\s+REG_QWORD\s+(0x[0-9a-fA-F]+)/.exec(block)?.[1]
    const dw = /HardwareInformation\.MemorySize\s+REG_(?:DWORD|BINARY)\s+(0x[0-9a-fA-F]+)/.exec(block)?.[1]
    if (!desc) continue
    const raw = qw ?? dw
    if (!raw) continue
    const bytes = Number(BigInt(raw))
    if (bytes > 0) result.push({ name: desc, vramMB: Math.round(bytes / (1024 * 1024)) })
  }
  return result
}

/** Choisit le GPU principal : le dédié avec le plus de VRAM, NVIDIA prioritaire à VRAM égale. */
export function pickPrimaryGpu(gpus: GpuInfo[]): number | null {
  let best: number | null = null
  gpus.forEach((g, i) => {
    if (g.integrated || g.vramMB <= 0) return
    const cur = best === null ? undefined : gpus[best]
    if (!cur) {
      best = i
      return
    }
    const score = (x: GpuInfo) => x.vramMB + (x.vendor === 'nvidia' ? 1 : 0)
    if (score(g) > score(cur)) best = i
  })
  return best
}

export function chooseAccelerator(gpu: GpuInfo | undefined): Accelerator {
  if (!gpu || gpu.integrated) return 'cpu'
  if (gpu.vendor === 'nvidia') {
    const cc = gpu.computeCapability ? Number.parseFloat(gpu.computeCapability) : undefined
    if (cc === undefined || cc >= MIN_CUDA_COMPUTE) return 'cuda'
    return 'vulkan'
  }
  if (gpu.vendor === 'amd' || gpu.vendor === 'intel') return 'vulkan'
  return 'cpu'
}

export function computeTier(usableVramMB: number, totalRamMB: number): HardwareAssessment['tier'] {
  const vram = usableVramMB + VRAM_SYSTEM_RESERVE_MB // les paliers sont exprimés en VRAM totale de la carte
  const gb = (mb: number) => mb / 1024
  if (gb(vram) >= 23 && gb(totalRamMB) >= 60) return 5
  if (gb(vram) >= 15.5) return 4
  if (gb(vram) >= 11.5) return 3
  if (gb(vram) >= 7.5) return 2
  if (gb(vram) >= 3.5) return 1
  return 0
}

export function assessHardware(input: {
  gpus: GpuInfo[]
  totalRamMB: number
  hasBattery: boolean
}): HardwareAssessment {
  const notes: string[] = []
  const primaryGpuIndex = pickPrimaryGpu(input.gpus)
  const gpu = primaryGpuIndex === null ? undefined : input.gpus[primaryGpuIndex]
  const accelerator = chooseAccelerator(gpu)
  const usableVramMB = gpu && accelerator !== 'cpu' ? Math.max(0, gpu.vramMB - VRAM_SYSTEM_RESERVE_MB) : 0
  const usableRamMB = Math.max(0, Math.round((input.totalRamMB - RAM_SYSTEM_RESERVE_MB) * 0.9))
  const tier = computeTier(usableVramMB, input.totalRamMB)
  const local3D = accelerator === 'cuda' && !!gpu && gpu.vramMB >= MIN_VRAM_LOCAL_3D_MB

  if (!gpu) {
    notes.push('Aucune carte graphique dédiée détectée : les modèles locaux tourneront sur le processeur. Les petits modèles restent utilisables ; le Cloud gratuit sera proposé pour les tâches lourdes.')
  } else {
    if (gpu.vramSource !== 'nvidia-smi' && gpu.vramSource !== 'registry') {
      notes.push(`La mémoire vidéo de ${gpu.name} n'a pas pu être mesurée précisément ; l'estimation peut être inexacte.`)
    }
    if (accelerator === 'cuda') notes.push(`Accélération CUDA sur ${gpu.name}.`)
    if (accelerator === 'vulkan') {
      notes.push(
        gpu.vendor === 'nvidia'
          ? `${gpu.name} est trop ancienne pour CUDA dans les moteurs embarqués : accélération Vulkan.`
          : `Accélération Vulkan sur ${gpu.name} (texte et images en local).`
      )
    }
  }
  if (!local3D) {
    notes.push(
      gpu && gpu.vendor !== 'nvidia'
        ? 'Génération 3D locale indisponible : les générateurs 3D exigent une carte NVIDIA. Le mode « 3D Cloud gratuit » sera proposé.'
        : 'Génération 3D locale indisponible (carte NVIDIA de 6 Go minimum requise). Le mode « 3D Cloud gratuit » sera proposé.'
    )
  }
  if (input.totalRamMB < 8 * 1024) {
    notes.push('Moins de 8 Go de RAM : les modèles locaux sont déconseillés, le Cloud gratuit reste disponible.')
  }
  if (input.hasBattery) {
    notes.push('Ordinateur portable détecté : les modèles locaux consomment beaucoup d\'énergie sur batterie.')
  }
  notes.push('Ce choix est provisoire : il sera confirmé par un test réel au premier lancement d\'un moteur local.')

  return { accelerator, primaryGpuIndex, usableVramMB, usableRamMB, tier, local3D, notes }
}
