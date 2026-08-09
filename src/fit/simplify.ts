import { CELL_MM } from '../core/units'
import type { Vec } from '../core/vec'

// Piirretyn viivan siivous (README luku 5 kohta 1): harvennus + Ramer–Douglas–
// Peucker. Sormen vapina on kohinaa eikä aikomus, joten se poistetaan ennen
// sovitusta — "piirretty viiva on aikomus, ei komento".

/** Tätä lähempänä olevat peräkkäiset näytteet ovat samaa kosketusta. */
export const DEFAULT_MIN_STEP_MM = 5

/** RDP-toleranssi: tätä pienemmät mutkat ovat vapinaa. */
export const DEFAULT_RDP_TOLERANCE_MM = 14

/** Päät tätä lähempänä toisiaan = käyttäjä tarkoitti silmukkaa (nappausetäisyys ~1 solu). */
export const DEFAULT_CLOSE_THRESHOLD_MM = CELL_MM

/** Lyhyempi veto on vahinko, ei rata. */
export const MIN_DRAWING_LENGTH_MM = 300

export interface CleanDrawing {
  /** Siivottu murtoviiva; suljetulla viivalla viimeinen piste on sama kuin ensimmäinen. */
  points: Vec[]
  closed: boolean
  lengthMm: number
}

export interface CleanOptions {
  minStepMm?: number
  toleranceMm?: number
  closeThresholdMm?: number
}

export function polylineLength(points: readonly Vec[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return total
}

/** Poistaa liian tiheät näytteet. Päätepiste säilyy aina. */
export function dropDenseSamples(points: readonly Vec[], minStepMm = DEFAULT_MIN_STEP_MM): Vec[] {
  if (points.length === 0) return []
  const kept: Vec[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const previous = kept[kept.length - 1]
    if (Math.hypot(points[i].x - previous.x, points[i].y - previous.y) >= minStepMm) kept.push(points[i])
  }
  // Vedon viimeinen piste on aikomus siinä missä ensimmäinenkin, joten se
  // säilytetään vaikka se olisi harvennuskynnystä lähempänä edellistä.
  const last = points[points.length - 1]
  const tail = kept[kept.length - 1]
  if (tail.x !== last.x || tail.y !== last.y) kept.push(last)
  return kept
}

/** Pisteen etäisyys janasta; nollan mittainen jana rappeutuu pistevälimatkaksi. */
function distanceToSegment(point: Vec, from: Vec, to: Vec): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return Math.hypot(point.x - from.x, point.y - from.y)
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq))
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t))
}

/**
 * Ramer–Douglas–Peucker eksplisiittisellä pinolla: pitkä veto voi tuottaa
 * tuhansia pisteitä, eikä rekursiosyvyys saa riippua käyttäjän sormesta.
 */
export function simplifyRdp(points: readonly Vec[], toleranceMm = DEFAULT_RDP_TOLERANCE_MM): Vec[] {
  if (points.length <= 2) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true

  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number]
    let furthest = -1
    let furthestDistance = toleranceMm
    for (let i = first + 1; i < last; i += 1) {
      const distance = distanceToSegment(points[i], points[first], points[last])
      if (distance > furthestDistance) {
        furthest = i
        furthestDistance = distance
      }
    }
    if (furthest < 0) continue
    keep[furthest] = true
    stack.push([first, furthest], [furthest, last])
  }

  return points.filter((_, index) => keep[index])
}

/** Tasavälinen näytteistys; käytetään testeissä ja piirretyn viivan esikatselussa. */
export function resamplePolyline(points: readonly Vec[], stepMm: number): Vec[] {
  if (points.length < 2 || stepMm <= 0) return [...points]
  const output: Vec[] = [points[0]]
  let carry = 0
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]
    const to = points[i]
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    if (length === 0) continue
    let travelled = stepMm - carry
    while (travelled <= length) {
      const t = travelled / length
      output.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
      travelled += stepMm
    }
    carry = (carry + length) % stepMm
  }
  const last = points[points.length - 1]
  const tail = output[output.length - 1]
  if (Math.hypot(last.x - tail.x, last.y - tail.y) > 1e-9) output.push(last)
  return output
}

/**
 * Siivoaa raakaveron sovituskelpoiseksi murtoviivaksi. Palauttaa null, jos
 * vedosta ei jää kahta erillistä pistettä — kutsuja hylkää yrityksen siististi.
 */
export function cleanDrawing(raw: readonly Vec[], options: CleanOptions = {}): CleanDrawing | null {
  const thinned = dropDenseSamples(raw, options.minStepMm ?? DEFAULT_MIN_STEP_MM)
  if (thinned.length < 2) return null

  const rawLengthMm = polylineLength(thinned)
  const closeThresholdMm = options.closeThresholdMm ?? DEFAULT_CLOSE_THRESHOLD_MM
  const first = thinned[0]
  const last = thinned[thinned.length - 1]
  // Silmukka vaatii sekä lähekkäiset päät että sen verran matkaa, ettei lyhyt
  // edestakainen veto tulkitse itseään lenkiksi.
  const closed = Math.hypot(last.x - first.x, last.y - first.y) <= closeThresholdMm && rawLengthMm > closeThresholdMm * 3

  const simplified = simplifyRdp(thinned, options.toleranceMm ?? DEFAULT_RDP_TOLERANCE_MM)
  if (closed) simplified[simplified.length - 1] = { x: first.x, y: first.y }
  if (simplified.length < 2) return null

  return { points: simplified, closed, lengthMm: polylineLength(simplified) }
}
