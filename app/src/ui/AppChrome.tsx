export function AppChrome() {
  return (
    <div className="app-chrome">
      <header className="app-title-bar">
        <p className="app-kicker">Studio</p>
        <h1 className="app-title">Procedural World Building</h1>
      </header>

      <aside className="side-panel" aria-label="Scene controls">
        <h2 className="panel-title">Controls</h2>
        <p className="panel-hint">
          Drag to orbit, scroll to zoom, right-drag to pan. Sliders will appear
          here later.
        </p>
        <div className="slider-slots">
          <label className="slider-slot">
            <span>Parameter</span>
            <input type="range" disabled aria-disabled="true" />
          </label>
          <label className="slider-slot">
            <span>Parameter</span>
            <input type="range" disabled aria-disabled="true" />
          </label>
        </div>
      </aside>
    </div>
  )
}
