import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  footer: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-[fadeIn_160ms_ease-out]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line-strong bg-surface shadow-2xl shadow-black/50 outline-none data-[state=open]:animate-[popIn_200ms_cubic-bezier(0.22,1,0.36,1)]">
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <div>
              <Dialog.Title className="text-[16px] font-semibold tracking-[-0.01em]">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-[13px] text-fg-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded-md p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Fermer">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          {children && <div className="space-y-4 px-6 pt-5">{children}</div>}
          <div className="mt-6 flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
