import { motion } from 'motion/react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import * as Tooltip from '@radix-ui/react-tooltip'
import logo from '../logo.png'
import { NAV } from '../nav'
import { useAsync, api } from '../lib/hooks'
import { cn } from './ui'
import { TaskDock } from './Tasks'
import { ErrorBoundary } from './ErrorBoundary'
import { UpdateBanner } from './UpdateBanner'
import { useTaskSync } from '../lib/tasks'

const FULL_BLEED = ['/assistant', '/images', '/3d']

const ACCEL_LABEL = { cuda: 'CUDA', vulkan: 'Vulkan', cpu: 'CPU' } as const

function Sidebar() {
  const { data: info } = useAsync(() => api.app.info())
  const { data: hw } = useAsync(() => api.hardware.get())

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="drag flex h-14 items-center gap-2.5 px-5">
        <img src={logo} alt="" className="size-6 rounded-md" draggable={false} />
        <span className="text-[14.5px] font-semibold tracking-[-0.01em]">AI Studio</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              cn(
                'group relative flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors duration-150',
                isActive ? 'text-fg' : 'text-fg-muted hover:bg-surface hover:text-fg'
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-lg border border-line-strong bg-surface-2"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                <item.icon className={cn('relative size-[17px] shrink-0', isActive && 'text-accent')} strokeWidth={1.75} />
                <span className="relative flex-1 truncate">{item.label}</span>
                {item.status === 'planned' && (
                  <span className="relative text-[10.5px] font-medium text-fg-subtle">{item.milestone.split(' · ')[0]}</span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <UpdateBanner />
      <div className="border-t border-line px-5 py-4">
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <div className="flex cursor-default items-center gap-2 text-[12px] text-fg-muted">
              <span className={cn('size-1.5 rounded-full', hw ? 'bg-accent' : 'bg-fg-subtle')} />
              {hw ? (
                <span className="truncate">
                  {ACCEL_LABEL[hw.assessment.accelerator]} ·{' '}
                  {hw.assessment.primaryGpuIndex !== null ? hw.gpus[hw.assessment.primaryGpuIndex]?.name : 'Processeur'}
                </span>
              ) : (
                <span>Analyse du matériel…</span>
              )}
            </div>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="top" sideOffset={8} className="z-50 max-w-[260px] rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[12px] text-fg-muted shadow-xl">
              Accélération choisie automatiquement pour les IA locales.
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <div className="mt-1.5 text-[11.5px] text-fg-subtle">Version {info?.version ?? '…'}</div>
      </div>
    </aside>
  )
}

export function Layout() {
  const location = useLocation()
  useTaskSync()
  const full = FULL_BLEED.includes(location.pathname)
  return (
    <Tooltip.Provider delayDuration={300}>
      <div className="flex h-full">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Barre de titre : zone de déplacement, les boutons Windows sont dessinés par le système à droite. */}
          <div className="drag h-10 shrink-0" />
          {full ? (
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="min-h-0 flex-1 border-t border-line"
            >
              <ErrorBoundary resetKey={location.pathname}>
                <Outlet />
              </ErrorBoundary>
            </motion.div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="mx-auto max-w-[1180px] px-10 pt-2 pb-12"
              >
                <ErrorBoundary resetKey={location.pathname}>
                  <Outlet />
                </ErrorBoundary>
              </motion.div>
            </div>
          )}
          <TaskDock />
        </main>
      </div>
    </Tooltip.Provider>
  )
}
