import { useEffect, useRef, useState } from 'preact/hooks'
import type { PieceLibrary } from '../core/library'
import type { Track } from '../gen/build'
import type { AreaShape } from '../gen/mask'
import { mountMapEngine, type MapEngineHandle, type MapEngineSnapshot } from './mapEngine'
import { screenTrackCss } from './trackStyles'

interface TrackMapProps {
  area: AreaShape
  track: Track | null
  library: PieceLibrary
  onSelect?: (snapshot: MapEngineSnapshot) => void
  /** Antaa juuri-SVG:n ulos vientiä varten. */
  svgRef?: { current: SVGSVGElement | null }
}

/**
 * Preact-kääre imperatiiviselle kartalle. Preact ei koskaan renderöi kartan
 * sisältöä uudelleen — se antaa vain alueen ja radan moottorille.
 */
export function TrackMap({ area, track, library, onSelect, svgRef }: TrackMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const localSvgRef = useRef<SVGSVGElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const engineRef = useRef<MapEngineHandle | null>(null)
  const [selection, setSelection] = useState<MapEngineSnapshot | null>(null)
  const [rotated, setRotated] = useState(false)

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
      { area, track },
      (snapshot) => {
        setSelection(snapshot)
        onSelect?.(snapshot)
      },
    )
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
    // Moottori mountataan kerran; alue ja rata päivitetään erikseen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library])

  useEffect(() => {
    engineRef.current?.update({ area, track })
  }, [area, track])

  return (
    <div class="map-wrap" ref={wrapRef}>
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
