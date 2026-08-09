import { describe, expect, it } from 'vitest'
import { makeRng } from '../core/rng'
import { CELL_MM } from '../core/units'
import { buildMask, cellCenter } from './mask'
import { MIN_LEG_CELLS, cornerIndices, growCycle, isValidCycle, perimeterRing, shortestLegCells, turnAt } from './route'

const livingRoom = buildMask({ kind: 'rect', widthMm: 2000, depthMm: 1500 })

describe('area mask', () => {
  it('divides the floor into logical cells', () => {
    expect(livingRoom.cols).toBe(Math.floor(2000 / CELL_MM))
    expect(livingRoom.rows).toBe(Math.floor(1500 / CELL_MM))
    expect(livingRoom.count).toBe(livingRoom.cols * livingRoom.rows)
  })

  it('centres the cell grid so the margin is even on both sides', () => {
    const centre = cellCenter(livingRoom, 0, 0)
    expect(centre.x).toBeCloseTo((2000 - livingRoom.cols * CELL_MM) / 2 + CELL_MM / 2, 9)
    expect(livingRoom.originMm.x * 2 + livingRoom.cols * CELL_MM).toBeCloseTo(2000, 9)
  })

  it('cuts a corner out of an L shape', () => {
    const mask = buildMask({ kind: 'L', widthMm: 2400, depthMm: 1800, cutWidthMm: 600, cutDepthMm: 600, corner: 'ne' })
    expect(mask.has(mask.cols - 1, 0)).toBe(false)
    expect(mask.has(0, 0)).toBe(true)
    expect(mask.has(mask.cols - 1, mask.rows - 1)).toBe(true)
    expect(mask.count).toBeLessThan(mask.cols * mask.rows)
  })

  it('reports an empty mask for a floor smaller than one cell', () => {
    expect(buildMask({ kind: 'rect', widthMm: 200, depthMm: 200 }).count).toBe(0)
  })
})

describe('perimeter ring', () => {
  it('walks a closed clockwise ring', () => {
    const ring = perimeterRing(livingRoom, 0, 0, 3, 3)
    expect(ring).not.toBeNull()
    expect(isValidCycle(ring!)).toBe(true)
    expect(ring!.cells).toHaveLength(2 * 4 + 2 * 4 - 4)
    // Myötäpäivään kierrettäessä jokainen kulma kääntyy oikealle.
    expect(cornerIndices(ring!).map((i) => turnAt(ring!, i))).toEqual([1, 1, 1, 1])
  })

  it('refuses a ring whose legs are shorter than a corner element needs', () => {
    expect(perimeterRing(livingRoom, 0, 0, 1, 3)).toBeNull()
  })

  it('refuses a ring that leaves the mask', () => {
    const mask = buildMask({ kind: 'L', widthMm: 2400, depthMm: 1800, cutWidthMm: 600, cutDepthMm: 600, corner: 'ne' })
    expect(perimeterRing(mask, mask.cols - 3, 0, mask.cols - 1, 2)).toBeNull()
  })
})

describe('cell route', () => {
  it('produces a valid closed cycle for every seed', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const cycle = growCycle(livingRoom, makeRng(seed))
      expect(cycle, `seed ${seed}`).not.toBeNull()
      expect(isValidCycle(cycle!), `seed ${seed}`).toBe(true)
    }
  })

  it('never creates a leg too short for a corner element', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const cycle = growCycle(livingRoom, makeRng(seed))
      expect(shortestLegCells(cycle!), `seed ${seed}`).toBeGreaterThanOrEqual(MIN_LEG_CELLS)
    }
  })

  it('stays inside an L-shaped mask', () => {
    const mask = buildMask({ kind: 'L', widthMm: 2600, depthMm: 2000, cutWidthMm: 800, cutDepthMm: 700, corner: 'se' })
    for (let seed = 0; seed < 20; seed += 1) {
      const cycle = growCycle(mask, makeRng(seed))
      expect(cycle).not.toBeNull()
      for (const cell of cycle!.cells) {
        expect(mask.has(cell.col, cell.row), `seed ${seed} cell ${cell.col},${cell.row}`).toBe(true)
      }
    }
  })

  it('is deterministic', () => {
    const first = growCycle(livingRoom, makeRng(17))
    const second = growCycle(livingRoom, makeRng(17))
    expect(first).toEqual(second)
  })

  it('varies across seeds', () => {
    const shapes = new Set(
      Array.from({ length: 20 }, (_, seed) => JSON.stringify(growCycle(livingRoom, makeRng(seed))?.cells)),
    )
    expect(shapes.size).toBeGreaterThan(3)
  })

  it('adds indentations, so not every route is a plain rectangle', () => {
    const cornerCounts = Array.from({ length: 30 }, (_, seed) => cornerIndices(growCycle(livingRoom, makeRng(seed))!).length)
    expect(cornerCounts).toContain(4)
    expect(cornerCounts.some((count) => count > 4)).toBe(true)
    // Sisäänpisto tuo neljä kulmaa kerrallaan, joten määrä pysyy parillisena.
    expect(cornerCounts.every((count) => count % 2 === 0)).toBe(true)
  })

  it('shrinks the ring when the inventory cannot reach around a big one', () => {
    const small = growCycle(livingRoom, makeRng(3), { maxPerimeterMm: 2000 })
    const large = growCycle(livingRoom, makeRng(3), { maxPerimeterMm: Infinity })
    expect(small!.cells.length).toBeLessThan(large!.cells.length)
  })

  it('returns null when no ring fits the mask at all', () => {
    expect(growCycle(buildMask({ kind: 'rect', widthMm: 400, depthMm: 400 }), makeRng(1))).toBeNull()
  })
})
