import type { PieceLibrary } from '../core/library'
import { offsetPolyline, toSvgPath } from '../core/path'
import type { Vec } from '../core/vec'
import { placedSegments, type PlacedPiece } from '../core/pieces'
import { GROOVE_SPACING_MM } from '../core/units'
import type { Track } from '../gen/build'
import { areaOutline, type AreaShape } from '../gen/mask'
import type { GapMark, Ghost } from './state'

// Rata piirretään geometriadatasta, ei kuva-asseteista (CLAUDE.md). Lauta on
// keskilinja levitettynä 40 mm:iin ja urat sen rinnakkaissiirtoja, joten
// piirto ja törmäystarkistus katsovat samaa geometriaa.

const SVG_NS = 'http://www.w3.org/2000/svg'

function pointsAttribute(points: readonly Vec[]): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
}

export function buildTrackGroup(track: Track, library: PieceLibrary): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', 'track')

  // Ylemmät tasot piirretään päälle, jotta silta näkyy alittavan radan yllä.
  const order = track.pieces
    .map((placed, index) => ({ placed, index }))
    .sort((a, b) => a.placed.placement.level - b.placed.placement.level)

  for (const { placed, index } of order) {
    group.appendChild(buildPieceGroup(placed, index, library))
  }
  return group
}

function buildPieceGroup(placed: PlacedPiece, index: number, library: PieceLibrary): SVGGElement {
  const piece = library.get(placed.pieceId)
  const segments = placedSegments(placed, piece)
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', `piece level-${placed.placement.level}`)
  group.setAttribute('data-piece-index', String(index))
  group.setAttribute('data-piece-id', placed.pieceId)

  const d = piece.pathData && segments.length === 0 ? '' : toSvgPath(segments)

  // Näkymätön leveä osumapolku ensin: sormella pitää osua helposti (README luku 7).
  if (d) {
    const hit = document.createElementNS(SVG_NS, 'path')
    hit.setAttribute('d', d)
    hit.setAttribute('class', 'piece-hit')
    group.appendChild(hit)

    const board = document.createElementNS(SVG_NS, 'path')
    board.setAttribute('d', d)
    board.setAttribute('class', 'piece-board')
    group.appendChild(board)

    for (const offset of [GROOVE_SPACING_MM / 2, -GROOVE_SPACING_MM / 2]) {
      const groove = document.createElementNS(SVG_NS, 'polyline')
      groove.setAttribute('points', pointsAttribute(offsetPolyline(segments, offset)))
      groove.setAttribute('class', 'piece-groove')
      group.appendChild(groove)
    }
  }

  if (piece.isTerminal) group.appendChild(buildBuffer(segments))
  return group
}

/** Puskurin punavalkoinen pääty piirretään radan poikki. */
function buildBuffer(segments: ReturnType<typeof placedSegments>): SVGLineElement {
  const half = 22
  const [left] = offsetPolyline(segments, half).slice(-1)
  const [right] = offsetPolyline(segments, -half).slice(-1)
  const bar = document.createElementNS(SVG_NS, 'line')
  bar.setAttribute('x1', String(left.x))
  bar.setAttribute('y1', String(left.y))
  bar.setAttribute('x2', String(right.x))
  bar.setAttribute('y2', String(right.y))
  bar.setAttribute('class', 'piece-buffer')
  return bar
}

/**
 * Haamuesikatselu: vain ne palat, jotka vaihtoehto lisäisi tai siirtäisi.
 * Epäselvyydet ratkaistaan kartalla eikä dialogeilla (README luku 6), joten
 * haamu on samalla napautuskohde — leveä näkymätön osumapolku tekee siitä
 * sormella osuttavan.
 */
export function buildGhostGroup(ghost: Ghost, library: PieceLibrary): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', 'ghost')
  group.setAttribute('data-ghost-index', String(ghost.index))

  for (const placed of ghost.pieces) {
    const piece = library.get(placed.pieceId)
    const d = toSvgPath(placedSegments(placed, piece))
    if (!d) continue

    const hit = document.createElementNS(SVG_NS, 'path')
    hit.setAttribute('d', d)
    hit.setAttribute('class', 'ghost-hit')
    group.appendChild(hit)

    const board = document.createElementNS(SVG_NS, 'path')
    board.setAttribute('d', d)
    board.setAttribute('class', 'piece-board')
    group.appendChild(board)

    const groove = document.createElementNS(SVG_NS, 'polyline')
    groove.setAttribute('points', pointsAttribute(offsetPolyline(placedSegments(placed, piece), 0)))
    groove.setAttribute('class', 'piece-groove')
    group.appendChild(groove)
  }

  return group
}

/**
 * Numerolappu: kartta kertoo itse, monesko vaihtoehto tämä on. Laput
 * piirretään omana kerroksenaan **kaikkien haamujen päälle** (`render.ts`),
 * koska lappu on se mihin sormi tähtää — toisen haamun alle jäänyttä lappua ei
 * voi napauttaa, ja juuri siitä syntyi vika, jossa lappu lupasi yhden vaihteen
 * ja radalle tuli toinen (docs/BRANCHING.md).
 */
export function buildGhostTag(ghost: Ghost, rotated: boolean): SVGGElement {
  const tag = document.createElementNS(SVG_NS, 'g')
  tag.setAttribute('data-ghost-index', String(ghost.index))
  // Kartta voi olla käännetty ruudulle sopimaan; numero ei saa kääntyä mukana.
  if (rotated) tag.setAttribute('transform', `rotate(-90 ${ghost.tag.x.toFixed(1)} ${ghost.tag.y.toFixed(1)})`)
  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', ghost.tag.x.toFixed(1))
  circle.setAttribute('cy', ghost.tag.y.toFixed(1))
  circle.setAttribute('r', '48')
  circle.setAttribute('class', 'ghost-tag')
  tag.appendChild(circle)

  const text = document.createElementNS(SVG_NS, 'text')
  text.setAttribute('x', ghost.tag.x.toFixed(1))
  text.setAttribute('y', ghost.tag.y.toFixed(1))
  text.setAttribute('class', 'ghost-tag-text')
  text.textContent = String(ghost.index + 1)
  tag.appendChild(text)
  return tag
}

/**
 * Aukkomerkki: katkoviiva poistetun osion päätyporttien välissä. Merkki ei ole
 * rata vaan kysymys, joten se piirretään radan tyyleistä erilleen.
 */
export function buildGapMark(gap: GapMark): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', 'gap-mark')

  const line = document.createElementNS(SVG_NS, 'line')
  line.setAttribute('x1', gap.start.x.toFixed(1))
  line.setAttribute('y1', gap.start.y.toFixed(1))
  line.setAttribute('x2', gap.end.x.toFixed(1))
  line.setAttribute('y2', gap.end.y.toFixed(1))
  line.setAttribute('class', 'gap-line')
  group.appendChild(line)

  // Päätyportit merkitään erikseen: juuri niihin täyttö tai piirto kiinnittyy.
  for (const point of [gap.start, gap.end]) {
    const circle = document.createElementNS(SVG_NS, 'circle')
    circle.setAttribute('cx', point.x.toFixed(1))
    circle.setAttribute('cy', point.y.toFixed(1))
    circle.setAttribute('r', '22')
    circle.setAttribute('class', 'gap-end')
    group.appendChild(circle)
  }
  return group
}

export function buildAreaShape(area: AreaShape): SVGPolygonElement {
  const polygon = document.createElementNS(SVG_NS, 'polygon')
  polygon.setAttribute('points', pointsAttribute(areaOutline(area)))
  polygon.setAttribute('class', 'floor-border')
  return polygon
}
