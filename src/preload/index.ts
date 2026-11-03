import { contextBridge, ipcRenderer } from 'electron'
import { IPC, MEDIA_SCHEME, type AiStudioApi } from '@shared/ipc'

const inv =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

function listen<T>(channel: string, listener: (v: T) => void): () => void {
  const handler = (_e: unknown, v: T) => listener(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: AiStudioApi = {
  app: {
    info: inv(IPC.appInfo) as AiStudioApi['app']['info'],
    openDataFolder: inv(IPC.appOpenData) as AiStudioApi['app']['openDataFolder'],
    openExternal: inv(IPC.appOpenExternal) as AiStudioApi['app']['openExternal'],
    showInFolder: inv(IPC.appShowInFolder) as AiStudioApi['app']['showInFolder'],
    mediaUrl: (path: string) => `${MEDIA_SCHEME}://f/${encodeURIComponent(path)}`
  },
  settings: { get: inv(IPC.settingsGet) as never, update: inv(IPC.settingsUpdate) as never },
  hardware: { get: (refresh) => ipcRenderer.invoke(IPC.hardwareGet, refresh === true), usage: inv(IPC.hardwareUsage) as never },
  projects: {
    list: inv(IPC.projectsList) as never,
    create: inv(IPC.projectsCreate) as never,
    update: inv(IPC.projectsUpdate) as never,
    remove: inv(IPC.projectsRemove) as never,
    pickFolder: inv(IPC.projectsPickFolder) as never,
    openFolder: inv(IPC.projectsOpenFolder) as never
  },
  activity: { list: inv(IPC.activityList) as never },
  updates: {
    status: inv(IPC.updatesStatus) as never,
    check: inv(IPC.updatesCheck) as never,
    install: inv(IPC.updatesInstall) as never,
    onStatus: (l) => listen(IPC.updatesEvent, l)
  },
  tasks: { list: inv(IPC.tasksList) as never, cancel: inv(IPC.tasksCancel) as never, onEvent: (l) => listen(IPC.tasksEvent, l) },
  engine: { status: inv('engine:status') as never, install: inv('engine:install') as never, stop: inv('engine:stop') as never },
  models: {
    catalog: inv('models:catalog') as never,
    installed: inv('models:installed') as never,
    loaded: inv('models:loaded') as never,
    capabilities: inv('models:capabilities') as never,
    registrySize: inv('models:registry-size') as never,
    pull: inv('models:pull') as never,
    remove: inv('models:remove') as never,
    unload: inv('models:unload') as never,
    speeds: inv('models:speeds') as never
  },
  cloud: {
    providers: inv('cloud:providers') as never,
    setKey: inv('cloud:set-key') as never,
    removeKey: inv('cloud:remove-key') as never,
    setEnabled: inv('cloud:set-enabled') as never,
    test: inv('cloud:test') as never,
    models: inv('cloud:models') as never,
    hfToken: inv('cloud:hf-token') as never,
    setHfToken: inv('cloud:set-hf-token') as never
  },
  chat: {
    list: inv('chat:list') as never,
    create: inv('chat:create') as never,
    update: inv('chat:update') as never,
    remove: inv('chat:remove') as never,
    get: inv('chat:get') as never,
    send: inv('chat:send') as never,
    stop: inv('chat:stop') as never,
    approve: inv('chat:approve') as never,
    revert: inv('chat:revert') as never,
    pickImages: inv('chat:pick-images') as never,
    onEvent: (l) => listen(IPC.chatEvent, l)
  },
  images: {
    status: inv('images:status') as never,
    installEngine: inv('images:install-engine') as never,
    installModel: inv('images:install-model') as never,
    removeModel: inv('images:remove-model') as never,
    generate: inv('images:generate') as never,
    cancel: inv('images:cancel') as never,
    list: inv('images:list') as never,
    remove: inv('images:remove') as never,
    pickInput: inv('images:pick-input') as never
  },
  mesh: {
    spaceStatus: inv('mesh:space-status') as never,
    generate: inv('mesh:generate') as never,
    list: inv('mesh:list') as never,
    import: inv('mesh:import') as never,
    remove: inv('mesh:remove') as never,
    saveExport: inv('mesh:save-export') as never
  }
}

contextBridge.exposeInMainWorld('aistudio', api)
