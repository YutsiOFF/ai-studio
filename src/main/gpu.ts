/**
 * Arbitre GPU minimal : une génération d'image ou de 3D locale réserve la carte
 * graphique ; les modèles de discussion locaux sont déchargés avant.
 */
let holder: string | null = null

export function gpuHolder(): string | null {
  return holder
}

export async function withGpu<T>(label: string, freeOthers: () => Promise<void>, fn: () => Promise<T>): Promise<T> {
  if (holder) throw new Error(`La carte graphique est déjà occupée : ${holder}. Attends la fin ou arrête-la.`)
  holder = label
  try {
    await freeOthers().catch(() => undefined)
    return await fn()
  } finally {
    holder = null
  }
}
