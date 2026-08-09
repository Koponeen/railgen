import type { PieceLibrary } from '../core/library'
import { unionBBox, type BBox } from '../core/path'
import { placedBBox } from '../core/pieces'
import { CELL_MM } from '../core/units'
import type { AreaShape } from '../gen/mask'
import { buildAreaShape, buildTrackGroup } from './trackSvg'
import type { AppState, Point, ViewTransform } from './state'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SELECTION_MARGIN_MM = 60
const MIN_SCALE = 0.4
const MAX_SCALE = 8

/**
 * Kahvan koko pysyy samana ruudulla, ei maailmassa: sormi on aina yhtä paksu,
 * vaikka kartta olisi zoomattu palan mittaan. Osuus alueen mitasta on säädetty
 * niin, että kokonäkymässä nuppi on ~44 px eli sormimitoituksen minimi
 * (UI-linjaus 3), ja zoom pienentää maailmasädettä samassa suhteessa.
 */
const HANDLE_SPAN_RATIO = 0.05
const HANDLE_MIN_RADIUS_MM = 12
const HANDLE_MAX_RADIUS_MM = 250
/** Osuma-alue on nuppia reilusti isompi: kahvaan pitää osua ilman tähtäilyä. */
const HANDLE_HIT_RATIO = 2.2

/** Näin kapeaa osiota ei zoomata koko ruudun kokoiseksi: konteksti katoaisi. */
const MIN_SELECTION_SPAN_MM = CELL_MM * 3

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

  // Piirretty viiva jää radan alle haaleaksi: sovitus on tulkinta aikomuksesta,
  // ja käyttäjän pitää nähdä molemmat (README luku 5).
  for (const line of state.lines) {
    if (line.points.length >= 2) world.appendChild(buildLinePath(line.points, 'line guide'))
  }

  if (state.track) {
    const track = buildTrackGroup(state.track, library)
    for (const index of state.selection ?? []) {
      track.querySelector(`[data-piece-index="${index}"]`)?.classList.add('selected')
    }
    world.appendChild(track)
  }

  if (draft && draft.length >= 2) {
    world.appendChild(buildLinePath(draft, 'line draft'))
  }

  // Kahvat piirretään päällimmäisiksi: ne ovat sormen kohde, eivät koriste.
  if (state.handles) {
    const radiusMm = handleRadiusMm(state)
    world.appendChild(buildHandle(state.handles.start, 'start', radiusMm))
    world.appendChild(buildHandle(state.handles.end, 'end', radiusMm))
  }
}

function handleRadiusMm(state: AppState): number {
  const span = Math.max(state.area.widthMm, state.area.depthMm)
  return clamp((span * HANDLE_SPAN_RATIO) / state.view.scale, HANDLE_MIN_RADIUS_MM, HANDLE_MAX_RADIUS_MM)
}

/** Osion päätykahva: näkyvä nuppi ja sen ympärillä reilu näkymätön osuma-alue. */
function buildHandle(point: Point, id: string, radiusMm: number): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', 'handle')
  group.setAttribute('data-handle', id)

  for (const [className, radius] of [
    ['handle-hit', radiusMm * HANDLE_HIT_RATIO],
    ['handle-knob', radiusMm],
  ] as const) {
    const circle = document.createElementNS(SVG_NS, 'circle')
    circle.setAttribute('cx', point.x.toFixed(1))
    circle.setAttribute('cy', point.y.toFixed(1))
    circle.setAttribute('r', radius.toFixed(1))
    circle.setAttribute('class', className)
    group.appendChild(circle)
  }
  // Renkaan viivakin skaalautuu, jotta nuppi näyttää samalta joka zoomilla.
  group.setAttribute('style', `--handle-stroke: ${(radiusMm * 0.3).toFixed(1)}`)
  return group
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

function buildLinePath(points: readonly Point[], className: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
  path.setAttribute('class', className)
  return path
}

/** Valitun osion äärimitat, joihin kartta zoomaa (README luku 7). */
export function selectionBBox(state: AppState, library: PieceLibrary): BBox | null {
  const boxes: BBox[] = []
  for (const index of state.selection ?? []) {
    const placed = state.track?.pieces[index]
    if (placed) boxes.push(placedBBox(placed, library.get(placed.pieceId)))
  }
  return boxes.length > 0 ? unionBBox(boxes) : null
}

/**
 * Koko lattia-alue täyttää aina juuri-SVG:n viewBoxin (preserveAspectRatio hoitaa
 * skaalauksen ruudulle), joten "koko näkymä" oman <g>-transformin osalta on identiteetti.
 */
export function fitView(): ViewTransform {
  return { x: 0, y: 0, scale: 1 }
}

export function zoomToBBox(bbox: BBox, area: AreaShape): ViewTransform {
  // Lyhyt osuus ei täytä ruutua yksinään: käyttäjän pitää nähdä mihin se
  // liittyy, muuten valinta menettää merkityksensä (README luku 7).
  const w = Math.max(bbox.maxX - bbox.minX + SELECTION_MARGIN_MM * 2, MIN_SELECTION_SPAN_MM)
  const h = Math.max(bbox.maxY - bbox.minY + SELECTION_MARGIN_MM * 2, MIN_SELECTION_SPAN_MM)
  const scale = clamp(Math.min(area.widthMm / w, area.depthMm / h), MIN_SCALE, MAX_SCALE)
  const cx = (bbox.minX + bbox.maxX) / 2
  const cy = (bbox.minY + bbox.maxY) / 2
  return { scale, x: area.widthMm / 2 - cx * scale, y: area.depthMm / 2 - cy * scale }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
