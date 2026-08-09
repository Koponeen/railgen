import { useEffect, useRef, useState } from 'preact/hooks'
import type { PieceLibrary } from '../core/library'
import type { Track } from '../gen/build'
import type { AreaShape } from '../gen/mask'
import { mountMapEngine, type MapEngineHandle, type MapEngineSnapshot } from './mapEngine'
import type { Mode, Point } from './state'
import { screenTrackCss } from './trackStyles'

interface TrackMapProps {
  area: AreaShape
  track: Track | null
  library: PieceLibrary
  /** Katselu- vai piirtotila; kartta palauttaa tilan katseluun vedon jälkeen. */
  mode?: Mode
  /** Piirretty viiva haaleana radan alla. */
  guide?: readonly Point[] | null
  onSelect?: (snapshot: MapEngineSnapshot) => void
  onDraw?: (points: Point[]) => void
  /** Antaa juuri-SVG:n ulos vientiä varten. */
  svgRef?: { current: SVGSVGElement | null }
}

/**
 * Preact-kääre imperatiiviselle kartalle. Preact ei koskaan renderöi kartan
 * sisältöä uudelleen — se antaa vain alueen ja radan moottorille.
 */
export function TrackMap({ area, track, library, mode = 'view', guide, onSelect, onDraw, svgRef }: TrackMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const localSvgRef = useRef<SVGSVGElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const engineRef = useRef<MapEngineHandle | null>(null)
  const [selection, setSelection] = useState<MapEngineSnapshot | null>(null)
  const [rotated, setRotated] = useState(false)

  // Moottori mountataan kerran, mutta callbackit vaihtuvat joka renderillä:
  // ref pitää kartan kutsumassa aina tuoreinta, ei mounttihetken versiota.
  const handlers = useRef({ onSelect, onDraw })
  handlers.current = { onSelect, onDraw }

  // Pyöritys on vain esitystason asia (README luku 7): pystyssä olevalla
  // puhelimella vaakasuuntainen lattia kääntyy neljänneskierroksen, jolloin se
  // täyttää ruudun sen sijaan että jäisi kapeaksi kaistaleeksi.
  useEffect(() => {
    const element = wrapRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return
      setRotated(area.widthMm >= area.depthMm !== box.width >= box.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [area.widthMm, area.depthMm])

  useEffect(() => {
    if (!wrapRef.current || !localSvgRef.current || !worldRef.current) return
    if (svgRef) svgRef.current = localSvgRef.current
    const engine = mountMapEngine(
      wrapRef.current,
      localSvgRef.current,
      worldRef.current,
      library,
      { area, track, guide },
      {
        onChange(snapshot) {
          setSelection(snapshot)
          handlers.current.onSelect?.(snapshot)
        },
        onDraw(points) {
          handlers.current.onDraw?.(points)
        },
      },
    )
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
    // Moottori mountataan kerran; alue, rata ja tila päivitetään erikseen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library])

  useEffect(() => {
    engineRef.current?.update({ area, track, guide })
  }, [area, track, guide])

  useEffect(() => {
    engineRef.current?.setMode(mode)
  }, [mode])

  return (
    <div class={mode === 'draw' ? 'map-wrap drawing' : 'map-wrap'} ref={wrapRef}>
      <svg
        class="map"
        ref={localSvgRef}
        viewBox={rotated ? `0 0 ${area.depthMm} ${area.widthMm}` : `0 0 ${area.widthMm} ${area.depthMm}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <style>{screenTrackCss()}</style>
        {/* Suuntaus omana ryhmänään, jotta se kuuluu kartan CTM:ään (eleet ja
            osumatestit toimivat sellaisenaan) muttei sotke näkymän transformia. */}
        <g id="orient" transform={rotated ? `translate(${area.depthMm} 0) rotate(90)` : undefined}>
          <g id="world" ref={worldRef} />
        </g>
      </svg>
      {selection?.selectedPieceId ? <div class="map-badge">{selection.selectedPieceId}</div> : null}
    </div>
  )
}
