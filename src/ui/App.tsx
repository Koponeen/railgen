import { useEffect, useRef, useState } from 'preact/hooks'
import { mountMapEngine, type MapEngineHandle, type MapEngineSnapshot } from './mapEngine'
import { WORLD_HEIGHT_MM, WORLD_WIDTH_MM } from './state'
import { Hud } from './Hud'
import { Toolbar } from './Toolbar'

const initialSnapshot: MapEngineSnapshot = {
  mode: 'view',
  canUndo: false,
  canRedo: false,
  lineCount: 0,
  selected: false,
  zoom: 1,
}

/**
 * Sovelluksen juuri. Preact piirtää vain kromin (HUD + toimintorivi);
 * kartta on imperatiivinen saareke, johon Preact ei koske uudelleenrenderöinnillä
 * (docs/IMPLEMENTATION_PLAN.md, vaihe 0).
 */
export function App() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const engineRef = useRef<MapEngineHandle | null>(null)
  const [snapshot, setSnapshot] = useState<MapEngineSnapshot>(initialSnapshot)

  useEffect(() => {
    if (!wrapRef.current || !svgRef.current || !worldRef.current) return
    engineRef.current = mountMapEngine(wrapRef.current, svgRef.current, worldRef.current, setSnapshot)
  }, [])

  return (
    <div id="app">
      <Hud snapshot={snapshot} />
      <div id="map-wrap" ref={wrapRef}>
        <svg
          id="map"
          ref={svgRef}
          viewBox={`0 0 ${WORLD_WIDTH_MM} ${WORLD_HEIGHT_MM}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <g id="world" ref={worldRef} />
        </svg>
      </div>
      <Toolbar
        mode={snapshot.mode}
        canUndo={snapshot.canUndo}
        canRedo={snapshot.canRedo}
        onToggleDraw={() => engineRef.current?.toggleDraw()}
        onUndo={() => engineRef.current?.undo()}
        onRedo={() => engineRef.current?.redo()}
        onFit={() => engineRef.current?.fit()}
      />
    </div>
  )
}
