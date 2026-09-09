import { WorldCanvas } from './scene/WorldCanvas.tsx'
import { AppChrome } from './ui/AppChrome.tsx'
import './App.css'

function App() {
  return (
    <div className="app-shell">
      <WorldCanvas />
      <AppChrome />
    </div>
  )
}

export default App
