import type { PieceLibrary } from '../core/library'
import type { BBox } from '../core/path'
import { placedBBox } from '../core/pieces'
import { CELL_MM } from '../core/units'
import type { AreaShape } from '../gen/mask'
import { buildAreaShape, buildTrackGroup } from './trackSvg'
import type { AppState, Point, ViewTransform } from './state'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SELECTION_MARGIN_MM = 60
const MIN_SCALE = 0.4
const MAX_SCALE = 8

export type { BBox }

export function transformString(view: ViewTransform): string {
  // Juuri-<g>: eleen aikana CSS-transform (GPU); sama merkkijono käytössä myös
  // lopullisen tilan renderöinnissä, jottei näytöllä näy hyppäystä (README luku 7).
  return `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
}

export function applyView(world: SVGGElement, view: ViewTransform): void {
  world.style.transform = transformString(view)
}

/** Piirtää koko sisällön uudelleen: lattia, gridi, rata ja mahdollinen kesken oleva veto. */
export function render(world: SVGGElement, state: AppState, draft: Point[] | null, library: PieceLibrary): void {
  applyView(world, state.view)
  world.replaceChildren()
  world.appendChild(buildFloor(state.area))

  if (state.track) {
    const track = buildTrackGroup(state.track, library)
    if (state.selectedPiece !== null) {
      track.querySelector(`[data-piece-index="${state.selectedPiece}"]`)?.classList.add('selected')
    }
    world.appendChild(track)
  }

  if (draft && draft.length >= 2) {
    world.appendChild(buildDraftPath(draft))
  }
}

function buildFloor(area: AreaShape): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('class', 'floor')
  g.appendChild(buildAreaShape(area))

  // Loogisen solun ruudukko auttaa hahmottamaan mittakaavan lattialla.
  for (let x = CELL_MM; x < area.widthMm; x += CELL_MM) {
    g.appendChild(gridLine(x, 0, x, area.depthMm))
  }
  for (let y = CELL_MM; y < area.depthMm; y += CELL_MM) {
    g.appendChild(gridLine(0, y, area.widthMm, y))
  }
  return g
}

function gridLine(x1: number, y1: number, x2: number, y2: number): SVGLineElement {
  const line = document.createElementNS(SVG_NS, 'line')
  line.setAttribute('x1', String(x1))
  line.setAttribute('y1', String(y1))
  line.setAttribute('x2', String(x2))
  line.setAttribute('y2', String(y2))
  line.setAttribute('class', 'grid-line')
  return line
}

function buildDraftPath(points: Point[]): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
  path.setAttribute('class', 'line draft')
  return path
}

export function pieceBBox(state: AppState, index: number, library: PieceLibrary): BBox | null {
  const placed = state.track?.pieces[index]
  if (!placed) return null
  return placedBBox(placed, library.get(placed.pieceId))
}

/**
 * Koko lattia-alue täyttää aina juuri-SVG:n viewBoxin (preserveAspectRatio hoitaa
 * skaalauksen ruudulle), joten "koko näkymä" oman <g>-transformin osalta on identiteetti.
 */
export function fitView(): ViewTransform {
  return { x: 0, y: 0, scale: 1 }
}

export function zoomToBBox(bbox: BBox, area: AreaShape): ViewTransform {
  const w = Math.max(bbox.maxX - bbox.minX, 1) + SELECTION_MARGIN_MM * 2
  const h = Math.max(bbox.maxY - bbox.minY, 1) + SELECTION_MARGIN_MM * 2
  const scale = clamp(Math.min(area.widthMm / w, area.depthMm / h), MIN_SCALE, MAX_SCALE)
  const cx = (bbox.minX + bbox.maxX) / 2
  const cy = (bbox.minY + bbox.maxY) / 2
  return { scale, x: area.widthMm / 2 - cx * scale, y: area.depthMm / 2 - cy * scale }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
