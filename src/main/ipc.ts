/**
 * Routeur IPC : seule porte d'entrée de l'interface vers le système.
 * Chaque entrée est validée avant usage ; les erreurs sont renvoyées sous forme de Result.
 */
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { ChatService } from './chat'
import type { CloudProviders } from './cloud'
import { listActivity, logActivity, type Db } from './db'
import type { OllamaEngine } from './engines/ollama'
import { cancelTask, listTasks } from './events'
import { getHardware, getUsage } from './hardware'
import { deleteGeneration, listGenerations, type ImageEngine } from './images'
import { allSpaceStatus, generateCloud3D, importMesh } from './mesh3d'
import type { LocalModels } from './models'
import { createProject, getProject, listProjects, removeProject, updateProject } from './projects'
import { readSettings, writeSettings } from './settings'
import { checkForUpdates, getUpdateStatus, installUpdate } from './updater'

const ALLOWED_EXTERNAL = /^https:\/\//i
const IMAGE_FILTERS = [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]

export interface Services {
  db: Db
  dataPath: string
  outputDir: string
  window: () => BrowserWindow | null
  ollama: OllamaEngine
  models: LocalModels
  cloud: CloudProviders
  chat: ChatService
  images: ImageEngine
}

async function wrap<T>(fn: () => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const str = z.string().min(1).max(4000)

export function isInside(dir: string, p: string): boolean {
  const a = resolve(dir)
  const b = resolve(p)
  return b === a || b.startsWith(a.endsWith(sep) ? a : a + sep)
}

export function registerIpc(s: Services): void {
  const { db, dataPath } = s
  const h = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, (_e, ...args) => fn(...args))
  const dialogParent = () => s.window() ?? undefined

  // ----- Application -----
  h(IPC.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    dataPath,
    isPackaged: app.isPackaged,
    platform: process.platform,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))
  h(IPC.appOpenData, async () => {
    await shell.openPath(dataPath)
  })
  h(IPC.appOpenExternal, async (url: unknown) => {
    const parsed = z.string().url().safeParse(url)
    if (parsed.success && ALLOWED_EXTERNAL.test(parsed.data)) await shell.openExternal(parsed.data)
  })
  h(IPC.appShowInFolder, (p: unknown) => {
    const parsed = str.safeParse(p)
    if (parsed.success && isInside(dataPath, parsed.data)) shell.showItemInFolder(parsed.data)
  })

  // ----- Paramètres, matériel, projets, activité -----
  h(IPC.settingsGet, () => readSettings(db))
  h(IPC.settingsUpdate, (patch: unknown) => {
    const next = writeSettings(db, patch)
    if (app.isPackaged && process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: next.launchAtStartup })
    logActivity(db, 'settings.updated', 'Paramètres modifiés', patch)
    return next
  })
  h(IPC.hardwareGet, (refresh: unknown) => getHardware(dataPath, refresh === true))
  h(IPC.hardwareUsage, () => getUsage(dataPath))
  h(IPC.projectsList, () => listProjects(db))
  h(IPC.projectsCreate, (input: unknown) => createProject(db, input))
  h(IPC.projectsUpdate, (input: unknown) => updateProject(db, input))
  h(IPC.projectsRemove, (id: unknown) => removeProject(db, id))
  h(IPC.projectsPickFolder, async () => {
    const res = await dialog.showOpenDialog(dialogParent()!, { title: 'Choisir le dossier du projet', properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  h(IPC.projectsOpenFolder, async (id: unknown) => {
    const parsed = z.string().uuid().safeParse(id)
    const project = parsed.success ? getProject(db, parsed.data) : undefined
    if (!project) return { ok: false, error: 'Projet introuvable.' }
    if (!project.folderExists) return { ok: false, error: "Le dossier n'existe plus." }
    const err = await shell.openPath(project.folder)
    return err ? { ok: false, error: err } : { ok: true, value: true }
  })
  h(IPC.activityList, (limit: unknown) => listActivity(db, typeof limit === 'number' ? limit : 200))

  // ----- Mises à jour, tâches -----
  h(IPC.updatesStatus, () => getUpdateStatus())
  h(IPC.updatesCheck, () => checkForUpdates())
  h(IPC.updatesInstall, () => installUpdate())
  h(IPC.tasksList, () => listTasks())
  h(IPC.tasksCancel, (id: unknown) => {
    if (typeof id === 'string') cancelTask(id)
  })

  // ----- Moteur local -----
  h('engine:status', () => s.models.engineStatus())
  h('engine:install', () =>
    wrap(async () => {
      const hw = await getHardware(dataPath)
      const gpu = hw.assessment.primaryGpuIndex !== null ? hw.gpus[hw.assessment.primaryGpuIndex] : undefined
      await s.ollama.install(hw.assessment.accelerator, gpu?.vendor)
      logActivity(db, 'engine.installed', 'Moteur local Ollama installé')
      return true as const
    })
  )
  h('engine:stop', () => s.ollama.stop())

  // ----- Modèles locaux -----
  h('models:catalog', () => s.models.catalog())
  h('models:installed', () => wrap(() => s.models.installed()))
  h('models:loaded', () => s.models.loaded().catch(() => []))
  h('models:capabilities', (tag: unknown) => wrap(() => s.models.capabilities(str.parse(tag))))
  h('models:registry-size', (tag: unknown) => s.models.registrySizeMB(str.parse(tag)))
  h('models:pull', (tag: unknown) => wrap(async () => (await s.models.pull(z.string().regex(/^[\w.\-/:]+$/).parse(tag)), true as const)))
  h('models:remove', (tag: unknown) => wrap(async () => (await s.models.remove(str.parse(tag)), true as const)))
  h('models:unload', (tag: unknown) => s.models.unload(str.parse(tag)).catch(() => undefined))
  h('models:speeds', () => s.models.measuredSpeeds())

  // ----- Cloud -----
  h('cloud:providers', () => {
    const states = s.cloud.states()
    return states.map((st) => ({ config: s.cloud.config(st.id), configured: st.configured, enabled: st.enabled, extra: st.extra, requestsToday: st.requestsToday }))
  })
  h('cloud:set-key', (id: unknown, key: unknown, extra: unknown) =>
    wrap(() => {
      s.cloud.setKey(str.parse(id), z.string().max(4000).parse(key), z.record(z.string(), z.string().max(200)).parse(extra ?? {}))
      return true as const
    })
  )
  h('cloud:remove-key', (id: unknown) => s.cloud.removeKey(str.parse(id)))
  h('cloud:set-enabled', (id: unknown, enabled: unknown) => s.cloud.setEnabled(str.parse(id), enabled === true))
  h('cloud:test', async (id: unknown) => {
    const r = await s.cloud.test(str.parse(id))
    return r.ok ? { ok: true, value: r.count } : r
  })
  h('cloud:models', (id: unknown, refresh: unknown) => wrap(() => s.cloud.models(str.parse(id), refresh === true)))
  h('cloud:hf-token', () => Boolean(s.cloud.hfToken()))
  h('cloud:set-hf-token', (token: unknown) => wrap(() => (s.cloud.setHfToken(z.string().max(200).parse(token)), true as const)))

  // ----- Assistant et agents -----
  h('chat:list', (projectId: unknown) => s.chat.list(typeof projectId === 'string' ? projectId : null))
  h('chat:create', (input: unknown) =>
    wrap(() =>
      s.chat.create(
        z.object({ modelRef: str, projectId: z.string().uuid().nullable().optional(), mode: z.enum(['chat', 'agent']).optional() }).parse(input)
      )
    )
  )
  h('chat:update', (id: unknown, patch: unknown) =>
    wrap(() => (s.chat.update(str.parse(id), z.object({ title: z.string().max(200).optional(), modelRef: str.optional(), mode: z.enum(['chat', 'agent']).optional() }).parse(patch)), true as const))
  )
  h('chat:remove', (id: unknown) => s.chat.remove(str.parse(id)))
  h('chat:get', (id: unknown) => wrap(() => s.chat.get(str.parse(id))))
  h('chat:send', (id: unknown, text: unknown, images: unknown) =>
    wrap(() => s.chat.send(str.parse(id), z.string().max(200_000).parse(text), z.array(z.string().max(20_000_000)).max(6).parse(images ?? [])))
  )
  h('chat:stop', (id: unknown) => s.chat.stop(str.parse(id)))
  h('chat:approve', (runId: unknown, callId: unknown, decision: unknown) => s.chat.approve(str.parse(runId), str.parse(callId), z.enum(['allow', 'deny', 'allow-all']).parse(decision)))
  h('chat:revert', (changeId: unknown) => wrap(() => (s.chat.revertChange(z.number().int().parse(changeId)), true as const)))
  h('chat:pick-images', async () => {
    const res = await dialog.showOpenDialog(dialogParent()!, { title: 'Joindre des images', properties: ['openFile', 'multiSelections'], filters: IMAGE_FILTERS })
    if (res.canceled) return []
    return res.filePaths
      .slice(0, 6)
      .filter((p) => statSync(p).size < 15 * 1024 * 1024)
      .map((p) => readFileSync(p).toString('base64'))
  })

  // ----- Images -----
  h('images:status', async () => {
    const cat = await s.models.catalog()
    return { engineInstalled: s.images.engineInstalled(), installed: cat.image.filter((m) => s.images.modelInstalled(m)).map((m) => m.id) }
  })
  h('images:install-engine', () => wrap(async () => (await s.images.installEngine(), true as const)))
  h('images:install-model', (id: unknown) =>
    wrap(async () => {
      const m = (await s.models.catalog()).image.find((x) => x.id === id)
      if (!m) throw new Error('Modèle inconnu.')
      await s.images.installModel(m)
      return true as const
    })
  )
  h('images:remove-model', async (id: unknown) => {
    const m = (await s.models.catalog()).image.find((x) => x.id === id)
    if (m) s.images.removeModel(m)
  })
  h('images:generate', (job: unknown) =>
    wrap(async () => {
      const j = z
        .object({
          modelId: str,
          prompt: z.string().min(1).max(4000),
          negative: z.string().max(4000).optional(),
          width: z.number().int().min(256).max(2048).multipleOf(8),
          height: z.number().int().min(256).max(2048).multipleOf(8),
          steps: z.number().int().min(1).max(150),
          cfg: z.number().min(0).max(30),
          seed: z.number().int().min(-1).max(2 ** 31),
          count: z.number().int().min(1).max(8),
          sampler: z.string().max(40).optional(),
          initImage: z.string().max(4000).optional(),
          strength: z.number().min(0).max(1).optional(),
          projectId: z.string().uuid().nullable().optional()
        })
        .parse(job)
      if (j.initImage && !isInside(dataPath, j.initImage)) throw new Error('Image de référence invalide.')
      const m = (await s.models.catalog()).image.find((x) => x.id === j.modelId)
      if (!m) throw new Error('Modèle inconnu.')
      return s.images.generate(m, j)
    })
  )
  h('images:cancel', () => s.images.cancel())
  h('images:list', () => listGenerations(db, 'image'))
  h('images:remove', (id: unknown) => deleteGeneration(db, str.parse(id)))
  h('images:pick-input', async () => {
    const res = await dialog.showOpenDialog(dialogParent()!, { title: 'Choisir une image', properties: ['openFile'], filters: IMAGE_FILTERS })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = join(s.outputDir, 'inputs')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, `${randomUUID()}${extname(res.filePaths[0]).toLowerCase()}`)
    copyFileSync(res.filePaths[0], dest)
    return dest
  })

  // ----- 3D -----
  h('mesh:space-status', () => allSpaceStatus())
  h('mesh:generate', (job: unknown) =>
    wrap(() => {
      const j = z
        .object({
          engine: z.enum(['trellis', 'trellis2', 'partcrafter', 'triposg', 'step1x', 'hunyuan21', 'instantmesh', 'hi3dgen']),
          imagePath: str,
          seed: z.number().int().min(0).max(2 ** 31),
          quality: z.enum(['fast', 'balanced', 'high']),
          textured: z.boolean(),
          numParts: z.number().int().min(1).max(16),
          textureSize: z.number().int().min(512).max(4096),
          projectId: z.string().uuid().nullable().optional(),
          prompt: z.string().max(4000).optional()
        })
        .parse(job)
      if (!isInside(dataPath, j.imagePath)) throw new Error('Image invalide.')
      return generateCloud3D(db, s.outputDir, { ...j, hfToken: s.cloud.hfToken() }, readSettings(db).allowRestrictedLicenses)
    })
  )
  h('mesh:list', () => listGenerations(db, 'mesh3d'))
  h('mesh:import', async () => {
    const res = await dialog.showOpenDialog(dialogParent()!, { title: 'Importer un modèle 3D', properties: ['openFile'], filters: [{ name: 'Modèles 3D', extensions: ['glb', 'gltf', 'obj', 'stl', 'ply'] }] })
    if (res.canceled || !res.filePaths[0]) return null
    return wrap(() => importMesh(db, s.outputDir, res.filePaths[0]!))
  })
  h('mesh:remove', (id: unknown) => deleteGeneration(db, str.parse(id)))
  h('mesh:save-export', async (defaultName: unknown, data: unknown) => {
    const name = z.string().max(200).parse(defaultName).replace(/[<>:"/\\|?*]/g, '_')
    if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new Error('Données invalides.')
    const ext = extname(name).slice(1) || 'glb'
    const res = await dialog.showSaveDialog(dialogParent()!, { title: 'Exporter le modèle 3D', defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (res.canceled || !res.filePath) return null
    const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)
    writeFileSync(res.filePath, view)
    logActivity(db, 'mesh3d.exported', `Modèle 3D exporté : ${res.filePath}`)
    return res.filePath
  })
}
