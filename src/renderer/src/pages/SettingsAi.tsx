import { CircleCheck, ExternalLink, KeyRound, Loader2, PlugZap, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ProviderView } from '@shared/ipc'
import { Badge, Button, Card, CardHeader, Skeleton, Toggle, inputClass } from '../components/ui'
import { api, useAsync } from '../lib/hooks'
import { toast } from '../lib/toast'

const BADGE: Record<string, { label: string; tone: 'accent' | 'cloud' | 'warn' | 'danger' }> = {
  'free-nokey': { label: 'Gratuit sans clé', tone: 'accent' },
  free: { label: 'Gratuit', tone: 'cloud' },
  trial: { label: 'Essai', tone: 'warn' },
  paid: { label: 'Payant', tone: 'danger' }
}

export function AiTab() {
  const providers = useAsync(() => api.cloud.providers())
  const hf = useAsync(() => api.cloud.hfToken())
  const [hfValue, setHfValue] = useState('')

  if (!providers.data) return <Skeleton className="h-80" />
  const free = providers.data.filter((p) => p.config.badge === 'free' || p.config.badge === 'free-nokey')
  const other = providers.data.filter((p) => p.config.badge === 'trial' || p.config.badge === 'paid')

  return (
    <div className="space-y-5">
      <Card className="flex items-start gap-3 border-local/20 bg-local/[0.04] px-5 py-4">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-local" />
        <div className="text-[13px] text-fg-muted">
          <span className="font-medium text-fg">Les modèles locaux n’utilisent aucune clé.</span> Les clés ci-dessous concernent uniquement les fournisseurs Cloud. Elles sont chiffrées par
          Windows et ne quittent jamais ton PC, sauf vers le fournisseur concerné. Quand tu utilises un modèle Cloud, tes messages sont envoyés à ce fournisseur.
        </div>
      </Card>

      <Card>
        <CardHeader title="Fournisseurs Cloud gratuits" description="Limites « connues » à la date indiquée ; les vraies limites sont lues pendant l’utilisation." />
        <ul className="divide-y divide-line">
          {free.map((p) => (
            <ProviderRow key={p.config.id} p={p} onChange={providers.reload} />
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Jeton Hugging Face (facultatif)" description="Un compte Hugging Face gratuit fait passer le quota GPU de la 3D Cloud de 2 à 5 minutes par jour." />
        <div className="flex items-center gap-2 px-5 py-4">
          {hf.data ? (
            <>
              <span className="flex flex-1 items-center gap-2 text-[13px] text-accent">
                <CircleCheck className="size-4" /> Jeton enregistré (chiffré)
              </span>
              <Button
                variant="ghost"
                icon={Trash2}
                onClick={async () => {
                  await api.cloud.setHfToken('')
                  void hf.reload()
                }}
              >
                Supprimer
              </Button>
            </>
          ) : (
            <>
              <input className={`${inputClass} font-mono`} type="password" placeholder="hf_…" value={hfValue} onChange={(e) => setHfValue(e.target.value)} />
              <Button
                variant="primary"
                disabled={!hfValue}
                onClick={async () => {
                  const r = await api.cloud.setHfToken(hfValue)
                  if (!r.ok) return toast.error(r.error)
                  setHfValue('')
                  toast.success('Jeton enregistré.')
                  void hf.reload()
                }}
              >
                Enregistrer
              </Button>
              <Button variant="ghost" icon={ExternalLink} onClick={() => api.app.openExternal('https://huggingface.co/settings/tokens')}>
                Créer
              </Button>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Crédits d’essai et fournisseurs payants" description="Jamais présentés comme gratuits. À ajouter seulement si tu le souhaites." />
        <ul className="divide-y divide-line">
          {other.map((p) => (
            <ProviderRow key={p.config.id} p={p} onChange={providers.reload} />
          ))}
        </ul>
      </Card>
    </div>
  )
}

function ProviderRow({ p, onChange }: { p: ProviderView; onChange: () => void }) {
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState('')
  const [extra, setExtra] = useState<Record<string, string>>(p.extra)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const c = p.config
  const b = BADGE[c.badge]!

  const test = async () => {
    setTesting(true)
    const r = await api.cloud.test(c.id)
    setTesting(false)
    setResult(r.ok ? `Connexion réussie : ${r.value} modèle(s) disponible(s).` : r.error)
    if (r.ok) toast.success(`${c.label} fonctionne.`)
  }

  return (
    <li className="px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium">{c.label}</span>
            <Badge tone={b.tone}>{b.label}</Badge>
            {p.configured && c.keyRequired && <Badge tone="local">Clé enregistrée</Badge>}
            {p.requestsToday > 0 && <span className="text-[11.5px] text-fg-subtle">{p.requestsToday} requête(s) aujourd’hui</span>}
          </div>
          <p className="mt-1 text-[12px] text-fg-muted">{c.knownLimits}</p>
          <p className="mt-0.5 text-[11.5px] text-fg-subtle">
            Hébergement : {c.hosting} · Entraînement sur tes données (offre gratuite) : {c.trainsOnFreeData} · Limites connues au {new Date(c.asOf).toLocaleDateString('fr-FR')}
            {c.notes ? ` · ${c.notes}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {p.configured && (
            <>
              <Toggle
                label="Activer"
                checked={p.enabled}
                onChange={async (v) => {
                  await api.cloud.setEnabled(c.id, v)
                  onChange()
                }}
              />
              <Button variant="ghost" icon={testing ? Loader2 : PlugZap} onClick={test} disabled={testing}>
                Tester
              </Button>
            </>
          )}
          {c.keyRequired && (
            <Button variant={p.configured ? 'ghost' : 'secondary'} icon={KeyRound} onClick={() => setEditing((e) => !e)}>
              {p.configured ? 'Modifier' : 'Ajouter une clé'}
            </Button>
          )}
        </div>
      </div>
      {result && <p className={`mt-2 text-[12px] ${result.startsWith('Connexion réussie') ? 'text-accent' : 'text-danger'}`}>{result}</p>}
      {editing && (
        <div className="mt-3 space-y-2 rounded-xl border border-line bg-bg/40 p-3">
          {c.extraField && (
            <input className={inputClass} placeholder={`${c.extraField.label} (${c.extraField.placeholder})`} value={extra[c.extraField.key] ?? ''} onChange={(e) => setExtra({ ...extra, [c.extraField!.key]: e.target.value })} />
          )}
          <div className="flex gap-2">
            <input className={`${inputClass} font-mono`} type="password" placeholder="Clé API" value={key} onChange={(e) => setKey(e.target.value)} />
            <Button
              variant="primary"
              disabled={!key && !c.extraField}
              onClick={async () => {
                const r = await api.cloud.setKey(c.id, key, extra)
                if (!r.ok) return toast.error(r.error)
                setKey('')
                setEditing(false)
                onChange()
                await test()
              }}
            >
              Enregistrer et tester
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <button className="flex items-center gap-1 text-[12px] text-cloud hover:underline" onClick={() => api.app.openExternal(c.signupUrl)}>
              <ExternalLink className="size-3" /> Obtenir une clé sur le site officiel
            </button>
            {p.configured && (
              <button
                className="flex items-center gap-1 text-[12px] text-danger hover:underline"
                onClick={async () => {
                  await api.cloud.removeKey(c.id)
                  setEditing(false)
                  onChange()
                }}
              >
                <Trash2 className="size-3" /> Supprimer la clé
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export function SecurityTab() {
  const rules = [
    ['Dossiers accessibles', 'Un agent ne travaille que dans le dossier du projet choisi. Les chemins qui en sortent (.., liens symboliques, chemins absolus) sont refusés.'],
    ['Lecture', 'Lecture, exploration et recherche de fichiers sont automatiques. Les fichiers de secrets (.env, clés, certificats) ne sont jamais lus ni modifiés.'],
    ['Modifications', 'Chaque création, modification ou déplacement de fichier t’est montré (avant / après) et attend ton autorisation. Chaque modification peut être annulée ensuite.'],
    ['Suppressions', 'Toujours confirmées, et les fichiers vont dans la Corbeille de Windows.'],
    ['Commandes', 'Chaque commande attend ton autorisation, sauf quelques commandes en lecture seule (git status, git diff…). Les commandes dangereuses (formatage, registre, arrêt…) sont bloquées. Délai maximal : 2 minutes par défaut.'],
    ['Arrêt immédiat', 'Le bouton « Arrêter » interrompt le modèle et met fin aux commandes en cours (et à leurs sous-processus).'],
    ['Historique', 'Toutes les actions des agents sont enregistrées localement (Historique et panneau d’activité de chaque conversation).'],
    ['Moteurs locaux', 'Ils n’écoutent que sur 127.0.0.1 : aucun autre appareil du réseau ne peut les utiliser.']
  ]
  return (
    <Card>
      <CardHeader title="Règles de sécurité appliquées" description="Ces protections sont actives pour tous les projets." />
      <ul className="divide-y divide-line">
        {rules.map(([t, d]) => (
          <li key={t} className="flex gap-3 px-5 py-3.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
            <div>
              <div className="text-[13px] font-medium">{t}</div>
              <div className="mt-0.5 text-[12.5px] text-fg-muted">{d}</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-5 py-3 text-[12px] text-fg-subtle">
        L’option « Tout autoriser pour cette tâche » ne vaut que pour la tâche en cours. Des permissions personnalisées par projet arriveront dans une prochaine version.
      </p>
    </Card>
  )
}
