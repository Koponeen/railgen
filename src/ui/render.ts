import { WORLD_HEIGHT_MM, WORLD_WIDTH_MM, type AppState, type DrawnLine, type Point, type ViewTransform } from './state'

const SVG_NS = 'http://www.w3.org/2000/svg'
const GRID_MM = 216 // Loginen solu, README luku 2.
const SELECTION_MARGIN_MM = 60
const MIN_SCALE = 0.4
const MAX_SCALE = 8

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function transformString(view: ViewTransform): string {
  // Juuri-<g>: eleen aikana CSS-transform (GPU); sama merkkijono käytössä myös
  // lopullisen tilan renderöinnissä, jottei näytöllä näy hyppäystä (README luku 7).
  return `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
}

export function applyView(world: SVGGElement, view: ViewTransform): void {
  world.style.transform = transformString(view)
}

/** Piirtää koko sisällön uudelleen: gridi, tallennetut viivat ja mahdollinen kesken oleva veto. */
export function render(world: SVGGElement, state: AppState, draft: Point[] | null): void {
  applyView(world, state.view)
  world.innerHTML = ''
  world.appendChild(buildGrid())
  for (const line of state.lines) {
    world.appendChild(buildLineGroup(line, line.id === state.selectedId))
  }
  if (draft && draft.length >= 2) {
    world.appendChild(buildDraftPath(draft))
  }
}

function buildGrid(): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g')
  g.setAttribute('class', 'grid')

  const border = document.createElementNS(SVG_NS, 'rect')
  border.setAttribute('x', '0')
  border.setAttribute('y', '0')
  border.setAttribute('width', String(WORLD_WIDTH_MM))
  border.setAttribute('height', String(WORLD_HEIGHT_MM))
  border.setAttribute('class', 'floor-border')
  g.appendChild(border)

  for (let x = GRID_MM; x < WORLD_WIDTH_MM; x += GRID_MM) {
    g.appendChild(gridLine(x, 0, x, WORLD_HEIGHT_MM))
  }
  for (let y = GRID_MM; y < WORLD_HEIGHT_MM; y += GRID_MM) {
    g.appendChild(gridLine(0, y, WORLD_WIDTH_MM, y))
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

function pointsToPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

function buildLineGroup(line: DrawnLine, selected: boolean): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g')
  const d = pointsToPath(line.points)

  // Näkymätön, leveä osumapolku ensin (helppo napauttaa sormella).
  const hit = document.createElementNS(SVG_NS, 'path')
  hit.setAttribute('d', d)
  hit.setAttribute('class', 'hit-path')
  hit.setAttribute('data-line-id', line.id)
  g.appendChild(hit)

  const visible = document.createElementNS(SVG_NS, 'path')
  visible.setAttribute('d', d)
  visible.setAttribute('class', selected ? 'line selected' : 'line')
  g.appendChild(visible)

  return g
}

function buildDraftPath(points: Point[]): SVGPathElement {
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', pointsToPath(points))
  path.setAttribute('class', 'line draft')
  return path
}

export function lineBBox(line: DrawnLine): BBox {
  const xs = line.points.map((p) => p.x)
  const ys = line.points.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/**
 * Koko lattia-alue täyttää aina juuri-SVG:n viewBoxin (preserveAspectRatio hoitaa
 * skaalauksen ruudulle), joten "koko näkymä" oman <g>-transformin osalta on identiteetti.
 */
export function fitView(): ViewTransform {
  return { x: 0, y: 0, scale: 1 }
}

export function zoomToBBox(bbox: BBox): ViewTransform {
  return fitBBox(bbox, SELECTION_MARGIN_MM)
}

function fitBBox(bbox: BBox, marginMm: number): ViewTransform {
  const w = Math.max(bbox.maxX - bbox.minX, 1) + marginMm * 2
  const h = Math.max(bbox.maxY - bbox.minY, 1) + marginMm * 2
  const scale = clamp(Math.min(WORLD_WIDTH_MM / w, WORLD_HEIGHT_MM / h), MIN_SCALE, MAX_SCALE)
  const cx = (bbox.minX + bbox.maxX) / 2
  const cy = (bbox.minY + bbox.maxY) / 2
  return {
    scale,
    x: WORLD_WIDTH_MM / 2 - cx * scale,
    y: WORLD_HEIGHT_MM / 2 - cy * scale,
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
