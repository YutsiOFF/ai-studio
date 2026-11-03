import type { AiStudioApi } from '../shared/ipc'

declare global {
  interface Window {
    aistudio: AiStudioApi
  }
}

export {}
