import { Cpu, MemoryStick, MonitorSmartphone, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import type { HardwareInfo } from '@shared/types'
import { Badge, Button, Card, CardHeader, Skeleton, Stat, formatMB } from './ui'

const ACCEL = {
  cuda: { label: 'CUDA', text: 'Carte NVIDIA' },
  vulkan: { label: 'Vulkan', text: 'Carte AMD / Intel / NVIDIA ancienne' },
  cpu: { label: 'CPU', text: 'Processeur uniquement' }
} as const

export function HardwareCard({
  hw,
  onRefresh,
  detailed = false
}: {
  hw: HardwareInfo | undefined
  onRefresh?: () => Promise<void>
  detailed?: boolean
}) {
  const [refreshing, setRefreshing] = useState(false)

  if (!hw) {
    return (
      <Card>
        <CardHeader title="Ton PC" description="Analyse du matériel en cours…" />
        <div className="grid grid-cols-4 gap-6 p-5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      </Card>
    )
  }

  const a = hw.assessment
  const gpu = a.primaryGpuIndex !== null ? hw.gpus[a.primaryGpuIndex] : undefined
  const simd = hw.cpu.simd.avx512 ? 'AVX-512' : hw.cpu.simd.avx2 ? 'AVX2' : hw.cpu.simd.avx ? 'AVX' : 'sans AVX'

  return (
    <Card>
      <CardHeader
        title="Ton PC"
        description="Détecté automatiquement. Les modèles proposés s'adapteront à ce matériel."
        action={
          onRefresh && (
            <Button
              variant="ghost"
              icon={RefreshCw}
              loading={refreshing}
              onClick={async () => {
                setRefreshing(true)
                await onRefresh()
                setRefreshing(false)
              }}
            >
              Relancer l'analyse
            </Button>
          )
        }
      />
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 p-5 lg:grid-cols-4">
        <Stat
          label="Carte graphique"
          value={gpu?.name ?? 'Aucune dédiée'}
          sub={gpu ? `${formatMB(gpu.vramMB)} de mémoire vidéo` : 'Calcul sur le processeur'}
        />
        <Stat label="Mémoire" value={formatMB(hw.memory.totalMB)} sub={hw.memory.type ?? 'RAM'} />
        <Stat label="Processeur" value={hw.cpu.brand} sub={`${hw.cpu.physicalCores} cœurs · ${hw.cpu.logicalCores} threads · ${simd}`} />
        <div>
          <div className="text-[11.5px] font-medium tracking-wide text-fg-subtle uppercase">Accélération IA</div>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge tone={a.accelerator === 'cpu' ? 'neutral' : 'accent'}>{ACCEL[a.accelerator].label}</Badge>
            <Badge tone="neutral">Profil {a.tier}</Badge>
          </div>
          <div className="mt-1 text-[12px] text-fg-muted">{ACCEL[a.accelerator].text}</div>
        </div>
      </div>

      <div className="border-t border-line px-5 py-4">
        <ul className="space-y-1.5">
          {a.notes.map((n) => (
            <li key={n} className="flex gap-2 text-[12.5px] text-fg-muted">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-fg-subtle" />
              {n}
            </li>
          ))}
        </ul>
      </div>

      {detailed && (
        <div className="grid gap-4 border-t border-line p-5 md:grid-cols-3">
          <DetailBlock icon={MonitorSmartphone} title="Cartes graphiques détectées">
            {hw.gpus.length === 0 && <li>Aucune</li>}
            {hw.gpus.map((g, i) => (
              <li key={`${g.name}-${i}`}>
                <span className="text-fg">{g.name}</span>
                <br />
                {g.integrated ? 'Intégrée' : `${formatMB(g.vramMB)} · source : ${g.vramSource}`}
                {g.computeCapability && ` · CUDA ${g.computeCapability}`}
                {g.driverVersion && ` · pilote ${g.driverVersion}`}
              </li>
            ))}
          </DetailBlock>
          <DetailBlock icon={MemoryStick} title="Budget mémoire pour l'IA">
            <li>VRAM utilisable : <span className="text-fg">{formatMB(a.usableVramMB)}</span></li>
            <li>RAM utilisable : <span className="text-fg">{formatMB(a.usableRamMB)}</span></li>
            <li>3D locale : <span className="text-fg">{a.local3D ? 'possible' : 'non (Cloud gratuit)'}</span></li>
          </DetailBlock>
          <DetailBlock icon={Cpu} title="Système">
            <li>{hw.os.distro} {hw.os.release} ({hw.os.arch})</li>
            <li>Espace libre (données) : <span className="text-fg">{formatMB(hw.disk.freeMB)}</span></li>
            <li>{hw.hasBattery ? 'Ordinateur portable' : 'Ordinateur fixe'}</li>
          </DetailBlock>
        </div>
      )}
    </Card>
  )
}

function DetailBlock({ icon: Icon, title, children }: { icon: typeof Cpu; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-bg/40 p-4">
      <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium">
        <Icon className="size-4 text-fg-subtle" strokeWidth={1.75} />
        {title}
      </div>
      <ul className="space-y-1.5 text-[12.5px] text-fg-muted" data-selectable>
        {children}
      </ul>
    </div>
  )
}
