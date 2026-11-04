/**
 * Types partagés entre le processus principal, le preload et l'interface.
 * Aucune dépendance : ce fichier ne doit importer que des types.
 */

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'other'

/** Source de la valeur de VRAM, pour savoir si elle est fiable. */
export type VramSource = 'nvidia-smi' | 'registry' | 'system' | 'unknown'

export interface GpuInfo {
  name: string
  vendor: GpuVendor
  /** VRAM dédiée en Mo (0 si inconnue ou GPU intégré sans mémoire dédiée). */
  vramMB: number
  vramSource: VramSource
  integrated: boolean
  driverVersion?: string
  /** NVIDIA uniquement, ex. "8.6". */
  computeCapability?: string
}

/** Moteur d'accélération retenu pour les calculs IA locaux. */
export type Accelerator = 'cuda' | 'vulkan' | 'cpu'

export interface HardwareInfo {
  os: { platform: string; release: string; arch: string; distro: string }
  cpu: {
    brand: string
    physicalCores: number
    logicalCores: number
    /** Instructions vectorielles détectées (choix des binaires llama.cpp / sd.cpp). */
    simd: { avx: boolean; avx2: boolean; avx512: boolean }
  }
  memory: { totalMB: number; type?: string }
  gpus: GpuInfo[]
  hasBattery: boolean
  disk: { dataPath: string; freeMB: number; totalMB: number }
  /** Décision dérivée (voir hardware-logic.ts). */
  assessment: HardwareAssessment
  detectedAt: string
}

export interface HardwareAssessment {
  accelerator: Accelerator
  /** GPU principal retenu (index dans `gpus`), ou null en mode CPU. */
  primaryGpuIndex: number | null
  /** VRAM réellement exploitable après la marge système, en Mo. */
  usableVramMB: number
  /** RAM exploitable pour les modèles, en Mo. */
  usableRamMB: number
  /** Profil 0 à 5 du système de recommandation (docs/PHASE1, §2.4-g). */
  tier: 0 | 1 | 2 | 3 | 4 | 5
  /** La génération 3D locale nécessite CUDA et au moins 6 Go. */
  local3D: boolean
  /** Explications lisibles, affichées telles quelles dans l'interface. */
  notes: string[]
}

export interface ResourceUsage {
  cpuLoadPercent: number
  memUsedMB: number
  memTotalMB: number
  /** Une entrée par GPU NVIDIA (mesure réelle via nvidia-smi). */
  gpus: { name: string; vramUsedMB: number; vramTotalMB: number; utilizationPercent: number }[]
  disk: { freeMB: number; totalMB: number }
  sampledAt: string
}

export interface Settings {
  launchAtStartup: boolean
  notifications: boolean
  autoCheckUpdates: boolean
  /** Moteurs dont la licence exclut certains territoires (ex. UE), activés en connaissance de cause. */
  allowRestrictedLicenses: boolean
}

export interface Project {
  id: string
  name: string
  description: string
  folder: string
  createdAt: string
  updatedAt: string
  /** Faux si le dossier n'existe plus sur le disque (vérifié à la lecture). */
  folderExists: boolean
}

export interface ActivityEntry {
  id: number
  ts: string
  type: string
  message: string
}

export interface AppInfo {
  name: string
  version: string
  dataPath: string
  isPackaged: boolean
  platform: string
  electron: string
  chrome: string
  node: string
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'unsupported'; reason: string }
  | { state: 'checking' }
  | { state: 'none'; checkedAt: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number; version?: string }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

/** Résultat standard des appels IPC qui peuvent échouer de façon attendue. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
