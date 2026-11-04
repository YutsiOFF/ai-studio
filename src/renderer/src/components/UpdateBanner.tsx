import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, Download, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { UpdateStatus } from '@shared/types'
import { api } from '../lib/hooks'
import { toast } from '../lib/toast'
import { Meter } from './ui'

/** Bandeau de mise à jour toujours visible dans la barre latérale. */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const announced = useRef('')
  const navigate = useNavigate()

  useEffect(() => {
    void api.updates.status().then(setStatus)
    return api.updates.onStatus((s) => {
      setStatus(s)
      if (s.state === 'ready' && announced.current !== s.version) {
        announced.current = s.version
        toast.success(`AI Studio ${s.version} est prête : redémarre pour l’installer.`)
      }
    })
  }, [])

  const visible = status.state === 'available' || status.state === 'downloading' || status.state === 'ready' || status.state === 'error'

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="mx-3 mb-3 rounded-xl border border-accent/30 bg-accent/[0.07] p-3"
        >
          {status.state === 'ready' ? (
            <>
              <div className="text-[12.5px] font-medium">Version {status.version} prête</div>
              <button
                onClick={() => api.updates.install()}
                className="mt-2 flex h-8 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[12.5px] font-semibold text-[#06140d] hover:bg-accent-strong"
              >
                <RotateCcw className="size-3.5" /> Redémarrer et installer
              </button>
            </>
          ) : status.state === 'error' ? (
            <button onClick={() => navigate('/settings')} className="flex w-full items-start gap-2 text-left text-[12px] text-fg-muted">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
              <span>La mise à jour automatique a échoué. Voir Paramètres &gt; Mises à jour.</span>
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2 text-[12.5px] font-medium">
                <Download className="size-3.5 text-accent" />
                Mise à jour {status.state === 'available' ? status.version : (status.version ?? '')}
              </div>
              <div className="mt-2">
                <Meter value={status.state === 'downloading' ? status.percent : 0} max={100} />
              </div>
              <div className="mt-1 text-[11px] text-fg-subtle">{status.state === 'downloading' ? `Téléchargement : ${status.percent} %` : 'Téléchargement en préparation…'}</div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
