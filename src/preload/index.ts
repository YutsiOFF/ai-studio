import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AiStudioApi } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'

const api: AiStudioApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openDataFolder: () => ipcRenderer.invoke(IPC.appOpenData),
    openExternal: (url) => ipcRenderer.invoke(IPC.appOpenExternal, url)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  },
  hardware: {
    get: (refresh) => ipcRenderer.invoke(IPC.hardwareGet, refresh === true),
    usage: () => ipcRenderer.invoke(IPC.hardwareUsage)
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    create: (input) => ipcRenderer.invoke(IPC.projectsCreate, input),
    update: (input) => ipcRenderer.invoke(IPC.projectsUpdate, input),
    remove: (id) => ipcRenderer.invoke(IPC.projectsRemove, id),
    pickFolder: () => ipcRenderer.invoke(IPC.projectsPickFolder),
    openFolder: (id) => ipcRenderer.invoke(IPC.projectsOpenFolder, id)
  },
  activity: {
    list: (limit) => ipcRenderer.invoke(IPC.activityList, limit)
  },
  updates: {
    status: () => ipcRenderer.invoke(IPC.updatesStatus),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    onStatus: (listener) => {
      const handler = (_e: unknown, s: UpdateStatus) => listener(s)
      ipcRenderer.on(IPC.updatesEvent, handler)
      return () => ipcRenderer.removeListener(IPC.updatesEvent, handler)
    }
  }
}

contextBridge.exposeInMainWorld('aistudio', api)
