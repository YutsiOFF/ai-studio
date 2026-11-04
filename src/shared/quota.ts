import type { GpuQuotaInfo } from './ipc'

/** Lit un message d'erreur ZeroGPU (« 90s requested vs. 57s left », « Try again in 13:59:24 »). */
export function parseQuotaError(raw: string, withAccount: boolean, now = Date.now()): (GpuQuotaInfo & { requestedSeconds?: number }) | null {
  if (!/quota|ZeroGPU/i.test(raw)) return null
  const left = /(\d+(?:\.\d+)?)\s*s\s*left/i.exec(raw)
  const req = /(\d+(?:\.\d+)?)\s*s\s*requested/i.exec(raw)
  const again = /try again in\s*(?:(\d+):)?(\d+):(\d+)/i.exec(raw)
  const resetAt = again ? new Date(now + ((Number(again[1] ?? 0) * 60 + Number(again[2])) * 60 + Number(again[3])) * 1000).toISOString() : undefined
  return {
    leftSeconds: left ? Math.floor(Number(left[1])) : 0,
    requestedSeconds: req ? Math.ceil(Number(req[1])) : undefined,
    resetAt,
    exhausted: true,
    at: new Date(now).toISOString(),
    withAccount
  }
}
