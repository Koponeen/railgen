import { useEffect, useRef, useState } from 'preact/hooks'
import type { PieceLibrary } from '../core/library'
import type { Track } from '../gen/build'
import type { AreaShape } from '../gen/mask'
import { mountMapEngine, type MapEngineHandle, type MapEngineSnapshot } from './mapEngine'
import type { Ghost, HandleId, Mode, Point, SectionHandles } from './state'
import { screenTrackCss } from './trackStyles'

interface TrackMapProps {
  area: AreaShape
  track: Track | null
  library: PieceLibrary
  /** Katselu- vai piirtotila; kartta palauttaa tilan katseluun vedon jälkeen. */
  mode?: Mode
  /** Piirretty viiva haaleana radan alla. */
  guide?: readonly Point[] | null
  /** Korostettava osio radan `pieces`-indekseinä. */
  selection?: readonly number[] | null
  /** Osion liukuvat päätykahvat. */
  handles?: SectionHandles | null
  /** Valittavat vaihtoehdot haamuina radan päällä. */
  ghosts?: readonly Ghost[] | null
  /** Pieni tunnus kartan kulmassa, esim. valitun osion mitta. */
  badge?: string | null
  onChange?: (snapshot: MapEngineSnapshot) => void
  onDraw?: (points: Point[]) => void
  onTapPiece?: (index: number | null) => void
  onTapGhost?: (index: number) => void
  onHandleMove?: (handle: HandleId, point: Point) => void
  onHandleEnd?: () => void
  /** Antaa juuri-SVG:n ulos vientiä varten. */
  svgRef?: { current: SVGSVGElement | null }
}

/**
 * Preact-kääre imperatiiviselle kartalle. Preact ei koskaan renderöi kartan
 * sisältöä uudelleen — se antaa vain sisällön ja callbackit moottorille.
 */
export function TrackMap({
  area,
  track,
  library,
  mode = 'view',
  guide,
  selection,
  handles,
  ghosts,
  badge,
  onChange,
  onDraw,
  onTapPiece,
  onTapGhost,
  onHandleMove,
  onHandleEnd,
  svgRef,
}: TrackMapProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const localSvgRef = useRef<SVGSVGElement>(null)
  const worldRef = useRef<SVGGElement>(null)
  const engineRef = useRef<MapEngineHandle | null>(null)
  const [rotated, setRotated] = useState(false)

  // Moottori mountataan kerran, mutta callbackit vaihtuvat joka renderillä:
  // ref pitää kartan kutsumassa aina tuoreinta, ei mounttihetken versiota.
  const handlers = useRef({ onChange, onDraw, onTapPiece, onTapGhost, onHandleMove, onHandleEnd })
  handlers.current = { onChange, onDraw, onTapPiece, onTapGhost, onHandleMove, onHandleEnd }

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
      { area, track, guide, selection, handles, ghosts, rotated },
      {
        onChange(snapshot) {
          handlers.current.onChange?.(snapshot)
        },
        onDraw(points) {
          handlers.current.onDraw?.(points)
        },
        onTapPiece(index) {
          handlers.current.onTapPiece?.(index)
        },
        onTapGhost(index) {
          handlers.current.onTapGhost?.(index)
        },
        onHandleMove(handle, point) {
          handlers.current.onHandleMove?.(handle, point)
        },
        onHandleEnd() {
          handlers.current.onHandleEnd?.()
        },
      },
    )
    engineRef.current = engine
    return () => {
      engine.destroy()
      engineRef.current = null
    }
    // Moottori mountataan kerran; sisältö ja tila päivitetään erikseen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library])

  useEffect(() => {
    engineRef.current?.update({ area, track, guide, selection, handles, ghosts, rotated })
  }, [area, track, guide, selection, handles, ghosts, rotated])

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
      {badge ? <div class="map-badge">{badge}</div> : null}
    </div>
  )
}
