import { EPS_MM, TRACK_WIDTH_MM } from './units'
import { transformDegrees, transformPoint, type Placement, type Vec } from './vec'

/**
 * Palan keskilinja segmentteinä. Tämä on ainoa geometrian totuuden lähde:
 * SVG piirretään tästä, pituus lasketaan tästä ja jalanjälki johdetaan tästä
 * (CLAUDE.md: "SVG piirretään geometriadatasta").
 *
 * Kaaren kulmat mitataan keskipisteestä samassa koordinaatistossa kuin muukin
 * geometria: piste = center + r * (cos a, sin a). Positiivinen `sweepDeg`
 * tarkoittaa kasvavaa kulmaa eli näytöllä (y alas) myötäpäivään.
 */
export type Segment =
  | { type: 'line'; from: Vec; to: Vec }
  | { type: 'arc'; center: Vec; radiusMm: number; startDeg: number; sweepDeg: number }

const DEG = Math.PI / 180

export function segmentStart(segment: Segment): Vec {
  if (segment.type === 'line') return segment.from
  return arcPoint(segment, 0)
}

export function segmentEnd(segment: Segment): Vec {
  if (segment.type === 'line') return segment.to
  return arcPoint(segment, 1)
}

/** Piste kaarella parametrilla t ∈ [0, 1]. */
export function arcPoint(arc: Extract<Segment, { type: 'arc' }>, t: number): Vec {
  const angle = (arc.startDeg + arc.sweepDeg * t) * DEG
  return { x: arc.center.x + arc.radiusMm * Math.cos(angle), y: arc.center.y + arc.radiusMm * Math.sin(angle) }
}

export function segmentPoint(segment: Segment, t: number): Vec {
  if (segment.type === 'line') {
    return { x: segment.from.x + (segment.to.x - segment.from.x) * t, y: segment.from.y + (segment.to.y - segment.from.y) * t }
  }
  return arcPoint(segment, t)
}

/** Kulkusuunta asteina segmentin kohdassa t. */
export function segmentHeadingDeg(segment: Segment, t: number): number {
  if (segment.type === 'line') {
    return Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x) / DEG
  }
  const angle = segment.startDeg + segment.sweepDeg * t
  return angle + (segment.sweepDeg >= 0 ? 90 : -90)
}

export function segmentLength(segment: Segment): number {
  if (segment.type === 'line') {
    return Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y)
  }
  return Math.abs(segment.sweepDeg) * DEG * segment.radiusMm
}

/** Keskilinjan yhteispituus — radan pituus lasketaan tästä (README luku 7). */
export function pathLength(segments: readonly Segment[]): number {
  return segments.reduce((sum, s) => sum + segmentLength(s), 0)
}

export function transformSegment(segment: Segment, placement: Placement): Segment {
  if (segment.type === 'line') {
    return { type: 'line', from: transformPoint(segment.from, placement), to: transformPoint(segment.to, placement) }
  }
  return {
    type: 'arc',
    center: transformPoint(segment.center, placement),
    radiusMm: segment.radiusMm,
    startDeg: transformDegrees(segment.startDeg, placement),
    sweepDeg: placement.mirror ? -segment.sweepDeg : segment.sweepDeg,
  }
}

function fmt(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

/** Keskilinja SVG-polkudatana. Kaaret piirretään aitoina kaarina, ei murtoviivana. */
export function toSvgPath(segments: readonly Segment[]): string {
  if (segments.length === 0) return ''
  const parts: string[] = []
  let cursor: Vec | null = null
  for (const segment of segments) {
    const start = segmentStart(segment)
    if (!cursor || Math.abs(cursor.x - start.x) > EPS_MM || Math.abs(cursor.y - start.y) > EPS_MM) {
      parts.push(`M${fmt(start.x)},${fmt(start.y)}`)
    }
    if (segment.type === 'line') {
      parts.push(`L${fmt(segment.to.x)},${fmt(segment.to.y)}`)
    } else {
      const end = segmentEnd(segment)
      const largeArc = Math.abs(segment.sweepDeg) > 180 ? 1 : 0
      const sweepFlag = segment.sweepDeg > 0 ? 1 : 0
      parts.push(`A${fmt(segment.radiusMm)},${fmt(segment.radiusMm)} 0 ${largeArc} ${sweepFlag} ${fmt(end.x)},${fmt(end.y)}`)
    }
    cursor = segmentEnd(segment)
  }
  return parts.join(' ')
}

/**
 * Näytteistää keskilinjan pisteiksi. Suorat jaetaan `maxStepMm`:n välein ja
 * kaaret vähintään 5°:n askeliin, jotta törmäystarkistus ei ohita keskikohtia.
 */
export function samplePath(segments: readonly Segment[], maxStepMm = 30): Vec[] {
  const points: Vec[] = []
  for (const segment of segments) {
    const steps =
      segment.type === 'line'
        ? Math.max(1, Math.ceil(segmentLength(segment) / maxStepMm))
        : Math.max(2, Math.ceil(Math.abs(segment.sweepDeg) / 5), Math.ceil(segmentLength(segment) / maxStepMm))
    for (let i = 0; i <= steps; i += 1) {
      const point = segmentPoint(segment, i / steps)
      const previous = points[points.length - 1]
      if (!previous || Math.abs(previous.x - point.x) > EPS_MM || Math.abs(previous.y - point.y) > EPS_MM) {
        points.push(point)
      }
    }
  }
  return points
}

/**
 * Jalanjälki: keskilinja levitettynä laudan leveyteen. Palautetaan yhtenä
 * monikulmiona (ulkoreuna eteenpäin, sisäreuna takaisin).
 */
export function footprintPolygon(segments: readonly Segment[], widthMm: number = TRACK_WIDTH_MM): Vec[] {
  const half = widthMm / 2
  const left: Vec[] = []
  const right: Vec[] = []
  for (const segment of segments) {
    const steps = segment.type === 'line' ? 1 : Math.max(2, Math.ceil(Math.abs(segment.sweepDeg) / 5))
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps
      const point = segmentPoint(segment, t)
      const heading = segmentHeadingDeg(segment, t) * DEG
      const nx = -Math.sin(heading)
      const ny = Math.cos(heading)
      left.push({ x: point.x + nx * half, y: point.y + ny * half })
      right.push({ x: point.x - nx * half, y: point.y - ny * half })
    }
  }
  return [...left, ...right.reverse()]
}

export interface BBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function polygonBBox(points: readonly Vec[]): BBox {
  const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const p of points) {
    box.minX = Math.min(box.minX, p.x)
    box.minY = Math.min(box.minY, p.y)
    box.maxX = Math.max(box.maxX, p.x)
    box.maxY = Math.max(box.maxY, p.y)
  }
  return box
}

export function unionBBox(boxes: readonly BBox[]): BBox {
  const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const b of boxes) {
    box.minX = Math.min(box.minX, b.minX)
    box.minY = Math.min(box.minY, b.minY)
    box.maxX = Math.max(box.maxX, b.maxX)
    box.maxY = Math.max(box.maxY, b.maxY)
  }
  return box
}

export function bboxesOverlap(a: BBox, b: BBox, toleranceMm = 0): boolean {
  return (
    a.minX < b.maxX - toleranceMm &&
    b.minX < a.maxX - toleranceMm &&
    a.minY < b.maxY - toleranceMm &&
    b.minY < a.maxY - toleranceMm
  )
}
