import {
  Box,
  FolderKanban,
  HardDrive,
  History,
  House,
  Image,
  Library,
  MessagesSquare,
  Settings,
  type LucideIcon
} from 'lucide-react'

export type ModuleStatus = 'available' | 'partial' | 'planned'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  status: ModuleStatus
  /** Étape du plan de développement (docs/PHASE2_ARCHITECTURE.md §17). */
  milestone: string
}

export const NAV: NavItem[] = [
  { path: '/', label: 'Accueil', icon: House, status: 'available', milestone: 'M1' },
  { path: '/projects', label: 'Projets', icon: FolderKanban, status: 'partial', milestone: 'M1 · M4' },
  { path: '/assistant', label: 'Assistant IA', icon: MessagesSquare, status: 'planned', milestone: 'M2 · M3' },
  { path: '/images', label: "Génération d'images", icon: Image, status: 'planned', milestone: 'M5' },
  { path: '/3d', label: 'Génération 3D', icon: Box, status: 'planned', milestone: 'M6 · M7' },
  { path: '/library', label: 'Bibliothèque de modèles', icon: Library, status: 'planned', milestone: 'M2' },
  { path: '/local-models', label: 'Modèles locaux', icon: HardDrive, status: 'planned', milestone: 'M2' },
  { path: '/history', label: 'Historique', icon: History, status: 'partial', milestone: 'M1 · M8' },
  { path: '/settings', label: 'Paramètres', icon: Settings, status: 'partial', milestone: 'M1 · M8' }
]
