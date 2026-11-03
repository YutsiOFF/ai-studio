import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Toaster } from './lib/toast'
import { HomePage } from './pages/Home'
import { ProjectsPage } from './pages/Projects'
import { HistoryPage } from './pages/History'
import { SettingsPage } from './pages/Settings'
import { AssistantPage, ImagesPage, LibraryPage, LocalModelsPage, ThreeDPage } from './pages/PlannedPages'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="assistant" element={<AssistantPage />} />
          <Route path="images" element={<ImagesPage />} />
          <Route path="3d" element={<ThreeDPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="local-models" element={<LocalModelsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <Toaster />
    </HashRouter>
  )
}
