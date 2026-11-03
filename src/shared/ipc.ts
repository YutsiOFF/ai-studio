/**
 * Contrat de l'API exposée à l'interface par le preload (`window.aistudio`).
 * Toute nouvelle fonctionnalité passe par ce contrat : l'interface n'a aucun
 * autre accès au système.
 */
import type {
  ActivityEntry,
  AppInfo,
  HardwareInfo,
  Project,
  ResourceUsage,
  Result,
  Settings,
  UpdateStatus
} from './types'

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

export interface AiStudioApi {
  app: {
    info(): Promise<AppInfo>
    openDataFolder(): Promise<void>
    openExternal(url: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: Partial<Settings>): Promise<Settings>
  }
  hardware: {
    /** Détection complète (mise en cache ; `refresh` force une nouvelle détection). */
    get(refresh?: boolean): Promise<HardwareInfo>
    usage(): Promise<ResourceUsage>
  }
  projects: {
    list(): Promise<Project[]>
    create(input: CreateProjectInput): Promise<Result<Project>>
    update(input: UpdateProjectInput): Promise<Result<Project>>
    /** Retire le projet d'AI Studio. Ne supprime jamais le dossier sur le disque. */
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
}

export const IPC = {
  appInfo: 'app:info',
  appOpenData: 'app:open-data',
  appOpenExternal: 'app:open-external',
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
  updatesEvent: 'updates:event'
} as const
