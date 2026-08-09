import { describe, expect, it } from 'vitest'
import { CELL_MM } from '../core/units'
import type { Vec } from '../core/vec'
import {
  cleanDrawing,
  dropDenseSamples,
  polylineLength,
  resamplePolyline,
  simplifyRdp,
} from './simplify'

function line(fromX: number, toX: number, stepMm: number, y = 0): Vec[] {
  const points: Vec[] = []
  for (let x = fromX; x <= toX; x += stepMm) points.push({ x, y })
  return points
}

describe('dropDenseSamples', () => {
  it('drops samples closer than the minimum step but keeps the endpoints', () => {
    const thinned = dropDenseSamples(line(0, 100, 1), 10)
    expect(thinned[0]).toEqual({ x: 0, y: 0 })
    expect(thinned[thinned.length - 1]).toEqual({ x: 100, y: 0 })
    expect(thinned.length).toBeLessThan(15)
  })

  it('keeps a two-point stroke even when the points are close together', () => {
    expect(dropDenseSamples([{ x: 0, y: 0 }, { x: 1, y: 0 }], 10)).toHaveLength(2)
  })
})

describe('simplifyRdp', () => {
  it('collapses a straight run to its endpoints', () => {
    expect(simplifyRdp(line(0, 500, 10), 5)).toEqual([{ x: 0, y: 0 }, { x: 500, y: 0 }])
  })

  it('keeps a corner that is larger than the tolerance', () => {
    const corner = [...line(0, 200, 20), ...line(200, 400, 20).map((p) => ({ x: 200, y: p.x - 200 }))]
    const simplified = simplifyRdp(corner, 10)
    expect(simplified.length).toBeGreaterThanOrEqual(3)
    expect(simplified).toContainEqual({ x: 200, y: 0 })
  })

  it('absorbs jitter below the tolerance', () => {
    const jittery = line(0, 600, 10).map((p, i) => ({ x: p.x, y: i % 2 === 0 ? 3 : -3 }))
    expect(simplifyRdp(jittery, 14)).toHaveLength(2)
  })

  // Sahalaidassa jokainen piste jää jäljelle ja jako menee maksimaalisen
  // epätasaisesti: rekursiivinen toteutus kaatuisi pinon syvyyteen.
  it('survives a stroke that cannot be simplified at all', () => {
    const zigzag = line(0, 5000, 1).map((p, i) => ({ x: p.x, y: i % 2 === 0 ? 40 : -40 }))
    expect(simplifyRdp(zigzag, 5).length).toBeGreaterThan(zigzag.length * 0.9)
  })
})

describe('resamplePolyline', () => {
  it('produces evenly spaced points', () => {
    const resampled = resamplePolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 25)
    expect(resampled.map((p) => Math.round(p.x))).toEqual([0, 25, 50, 75, 100])
  })
})

describe('cleanDrawing', () => {
  it('rejects a stroke that has no length', () => {
    expect(cleanDrawing([{ x: 5, y: 5 }])).toBeNull()
  })

  it('treats a stroke whose ends meet as a closed loop', () => {
    const loop: Vec[] = []
    for (let angle = 0; angle <= 360; angle += 5) {
      const rad = (angle * Math.PI) / 180
      loop.push({ x: 500 + Math.cos(rad) * 400, y: 500 + Math.sin(rad) * 400 })
    }
    const cleaned = cleanDrawing(loop)
    expect(cleaned?.closed).toBe(true)
    expect(cleaned?.points[0]).toEqual(cleaned?.points[cleaned.points.length - 1])
  })

  it('leaves an open stroke open', () => {
    const cleaned = cleanDrawing(line(0, 1200, 10))
    expect(cleaned?.closed).toBe(false)
    expect(cleaned?.lengthMm).toBeCloseTo(1200, 3)
  })

  it('does not call a short back-and-forth scribble a loop', () => {
    const scribble = [...line(0, CELL_MM, 5), ...line(0, CELL_MM, 5).reverse()]
    expect(cleanDrawing(scribble)?.closed).toBe(false)
  })
})

describe('polylineLength', () => {
  it('sums the segment lengths', () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 8 }])).toBeCloseTo(9, 6)
  })
})
