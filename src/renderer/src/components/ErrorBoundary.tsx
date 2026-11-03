import { CircleAlert, RotateCcw } from 'lucide-react'
import { Component, type ReactNode } from 'react'

/** Empêche une erreur d'affichage de rendre toute la page blanche. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: (error: Error, reset: () => void) => ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset)
    return (
      <div className="grid h-full min-h-[300px] place-items-center p-8 text-center">
        <div className="max-w-md">
          <CircleAlert className="mx-auto size-8 text-danger" />
          <h2 className="mt-3 text-[15px] font-semibold">Cette section a rencontré une erreur</h2>
          <p className="mt-1 text-[12.5px] break-words text-fg-muted" data-selectable>
            {this.state.error.message}
          </p>
          <button onClick={this.reset} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[13px] hover:bg-surface-3">
            <RotateCcw className="size-4" /> Réessayer
          </button>
        </div>
      </div>
    )
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'))
  } catch {
    return false
  }
}
