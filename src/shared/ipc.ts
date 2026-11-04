/**
 * Contrat de l'API exposée à l'interface par le preload (`window.aistudio`).
 * Toute fonctionnalité passe par ce contrat : l'interface n'a aucun autre accès au système.
 */
import type { Catalog } from './catalog'
import type { ChatEvent, ConversationDetail, ConversationSummary } from './chat'
import type { CloudProvider } from './providers'
import type { ActivityEntry, AppInfo, HardwareInfo, Project, ResourceUsage, Result, Settings, UpdateStatus } from './types'

export interface CreateProjectInput {
  name: string
  description: string
  folder: string
}

export interface UpdateProjectInput {
  id: string
  name?: string
  description?: string
}

export interface EngineStatus {
  installed: boolean
  running: boolean
  mode: 'external' | 'managed' | null
  version?: string
  downloadSizeMB?: number
}

export interface InstalledModel {
  name: string
  sizeMB: number
  modifiedAt: string
  family?: string
  parameterSize?: string
  quantization?: string
}

export interface LoadedModel {
  name: string
  sizeMB: number
  vramMB: number
  expiresAt?: string
}

export interface ModelCapabilities {
  tools: boolean
  vision: boolean
  thinking: boolean
  contextK?: number
}

export interface TaskEvent {
  id: string
  kind: 'engine' | 'model' | 'image' | 'mesh3d'
  label: string
  state: 'running' | 'done' | 'error' | 'cancelled'
  stage?: string
  received?: number
  total?: number
  speed?: number
  current?: number
  of?: number
  error?: string
}

export interface ProviderView {
  config: CloudProvider
  configured: boolean
  enabled: boolean
  extra: Record<string, string>
  requestsToday: number
}

export interface CloudModel {
  id: string
  label: string
  tools: boolean | null
  vision: boolean | null
  contextK?: number
}

export interface GenerationRecord {
  id: string
  kind: 'image' | 'mesh3d'
  projectId: string | null
  engine: string
  location: 'local' | 'cloud'
  prompt: string
  params: Record<string, unknown>
  files: string[]
  createdAt: string
}

export interface ImageJob {
  modelId: string
  prompt: string
  negative?: string
  width: number
  height: number
  steps: number
  cfg: number
  seed: number
  count: number
  sampler?: string
  initImage?: string
  strength?: number
  projectId?: string | null
}

export interface Mesh3DJob {
  engine: 'triposr-local' | 'triposg-local' | 'trellis' | 'trellis2' | 'trellis2-text' | 'shap-e' | 'partcrafter' | 'triposg' | 'step1x' | 'hunyuan21' | 'instantmesh' | 'hi3dgen'
  imagePath?: string
  seed: number
  quality: 'fast' | 'balanced' | 'high'
  textured: boolean
  numParts: number
  textureSize: number
  projectId?: string | null
  prompt?: string
}

export interface McpToolView {
  name: string
  description: string
  readOnly: boolean
}
export interface McpServerView {
  id: string
  label: string
  command: string
  enabled: boolean
  preset?: 'roblox'
  status: 'off' | 'connecting' | 'connected' | 'error'
  error?: string
  /** Préréglage : le serveur a été trouvé sur ce PC. */
  detected?: boolean
  tools: McpToolView[]
}

export type Local3DEngineId = 'triposr' | 'triposg'
export interface Local3DEngineStatus {
  id: Local3DEngineId
  installed: boolean
  supported: boolean
  reason?: string
  sizeEstimateMB: number
  note: string
}
export interface Local3DStatus {
  device: 'cuda' | 'cpu'
  vramMB: number
  engines: Record<Local3DEngineId, Local3DEngineStatus>
}

/** Dernier état connu du quota GPU gratuit Hugging Face (ZeroGPU), lu dans les réponses réelles. */
export interface GpuQuotaInfo {
  /** Secondes restantes annoncées par Hugging Face, si connues. */
  leftSeconds?: number
  /** Heure de réinitialisation estimée (ISO), si annoncée. */
  resetAt?: string
  exhausted: boolean
  /** Moment de la mesure (ISO). */
  at: string
  withAccount: boolean
}

export interface SpaceStatus {
  engine: string
  space: string
  available: boolean
  stage?: string
  hardware?: string
  error?: string
}

export interface AiStudioApi {
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    openExternal(url: string): Promise<void>
    showInFolder(path: string): Promise<void>
    /** URL utilisable dans l'interface pour un fichier généré par AI Studio. */
    mediaUrl(path: string): string
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
  }
  hardware: {
    get(refresh?: boolean): Promise<HardwareInfo>
    usage(): Promise<ResourceUsage>
  }
  projects: {
    list(): Promise<Project[]>
    create(input: CreateProjectInput): Promise<Result<Project>>
    update(input: UpdateProjectInput): Promise<Result<Project>>
    remove(id: string): Promise<Result<true>>
    pickFolder(): Promise<string | null>
    openFolder(id: string): Promise<Result<true>>
  }
  activity: {
    list(limit?: number): Promise<ActivityEntry[]>
  }
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    install(): Promise<void>
    onStatus(listener: (status: UpdateStatus) => void): () => void
  }
  tasks: {
    list(): Promise<TaskEvent[]>
    cancel(id: string): Promise<void>
    onEvent(listener: (e: TaskEvent) => void): () => void
  }
  engine: {
    status(): Promise<EngineStatus>
    install(): Promise<Result<true>>
    stop(): Promise<void>
  }
  models: {
    catalog(): Promise<Catalog>
    installed(): Promise<Result<InstalledModel[]>>
    loaded(): Promise<LoadedModel[]>
    capabilities(tag: string): Promise<Result<ModelCapabilities>>
    registrySize(tag: string): Promise<number | null>
    pull(tag: string): Promise<Result<true>>
    remove(tag: string): Promise<Result<true>>
    unload(tag: string): Promise<void>
    speeds(): Promise<Record<string, number>>
  }
  cloud: {
    providers(): Promise<ProviderView[]>
    setKey(id: string, key: string, extra: Record<string, string>): Promise<Result<true>>
    removeKey(id: string): Promise<void>
    setEnabled(id: string, enabled: boolean): Promise<void>
    test(id: string): Promise<Result<number>>
    models(id: string, refresh?: boolean): Promise<Result<CloudModel[]>>
    hfToken(): Promise<boolean>
    setHfToken(token: string): Promise<Result<true>>
    /** Connexion en un clic (navigateur) : la clé est récupérée et chiffrée automatiquement. */
    oauth(provider: 'openrouter'): Promise<Result<true>>
  }
  chat: {
    list(projectId?: string | null): Promise<ConversationSummary[]>
    create(input: { modelRef: string; projectId?: string | null; mode?: 'chat' | 'agent' }): Promise<Result<ConversationSummary>>
    update(id: string, patch: { title?: string; modelRef?: string; mode?: 'chat' | 'agent' }): Promise<Result<true>>
    remove(id: string): Promise<void>
    get(id: string): Promise<Result<ConversationDetail>>
    send(id: string, text: string, images?: string[]): Promise<Result<string>>
    stop(id: string): Promise<void>
    approve(runId: string, callId: string, decision: 'allow' | 'deny' | 'allow-all'): Promise<void>
    revert(changeId: number): Promise<Result<true>>
    pickImages(): Promise<string[]>
    onEvent(listener: (e: ChatEvent) => void): () => void
  }
  images: {
    status(): Promise<{ engineInstalled: boolean; installed: string[] }>
    installEngine(): Promise<Result<true>>
    installModel(id: string): Promise<Result<true>>
    removeModel(id: string): Promise<void>
    generate(job: ImageJob): Promise<Result<GenerationRecord>>
    cancel(): Promise<void>
    list(): Promise<GenerationRecord[]>
    remove(id: string): Promise<void>
    pickInput(): Promise<string | null>
  }
  mcp: {
    list(): Promise<McpServerView[]>
    setEnabled(id: string, enabled: boolean): Promise<Result<true>>
    add(input: { label: string; command: string; args: string[] }): Promise<Result<true>>
    remove(id: string): Promise<void>
  }
  local3d: {
    status(): Promise<Local3DStatus>
    install(engine: Local3DEngineId): Promise<Result<true>>
    remove(engine: Local3DEngineId): Promise<void>
  }
  mesh: {
    spaceStatus(): Promise<SpaceStatus[]>
    quota(): Promise<GpuQuotaInfo | null>
    generate(job: Mesh3DJob): Promise<Result<GenerationRecord>>
    list(): Promise<GenerationRecord[]>
    import(): Promise<Result<GenerationRecord> | null>
    remove(id: string): Promise<void>
    saveExport(defaultName: string, data: ArrayBuffer): Promise<string | null>
  }
}

export const IPC = {
  appInfo: 'app:info',
  appOpenData: 'app:open-data',
  appOpenExternal: 'app:open-external',
  appShowInFolder: 'app:show-in-folder',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  hardwareGet: 'hardware:get',
  hardwareUsage: 'hardware:usage',
  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsRemove: 'projects:remove',
  projectsPickFolder: 'projects:pick-folder',
  projectsOpenFolder: 'projects:open-folder',
  activityList: 'activity:list',
  updatesStatus: 'updates:status',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  updatesEvent: 'updates:event',
  tasksList: 'tasks:list',
  tasksCancel: 'tasks:cancel',
  tasksEvent: 'tasks:event',
  chatEvent: 'chat:event'
} as const

/** Schéma du protocole servant les fichiers générés à l'interface. */
export const MEDIA_SCHEME = 'aistudio-media'
