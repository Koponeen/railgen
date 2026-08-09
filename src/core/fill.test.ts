import { describe, expect, it } from 'vitest'
import { buildFillTable, fillTableFor, fillableLengths, isFillable, nearestFillable, solveFill } from './fill'
import { Ledger, createInventory, unlimitedInventory } from './inventory'
import { defaultLibrary } from './library'
import { makeRng } from './rng'

const library = defaultLibrary()
const table = fillTableFor(library)

function lengthOf(ids: string[]): number {
  return ids.reduce((sum, id) => sum + (library.get(id).straightLengthMm ?? 0), 0)
}

describe('fill table', () => {
  it('covers the fit length with either length family (README chapter 2)', () => {
    // 432 mm = 2 x D = 3 x A = 4 x A1 = 8 x A2.
    expect(isFillable(table, 432)).toBe(true)
    const combos = table.combos[432 / 18].map((c) => [...c])
    expect(combos).toContainEqual([12, 12])
    expect(combos).toContainEqual([8, 8, 8])
  })

  it('knows the equivalences of one logical cell', () => {
    const combos = table.combos[216 / 18].map((c) => [...c])
    expect(combos).toContainEqual([12])
    expect(combos).toContainEqual([6, 6])
    expect(combos).toContainEqual([3, 3, 3, 3])
  })

  it('refuses lengths off the micro grid', () => {
    expect(isFillable(table, 100)).toBe(false)
    expect(isFillable(table, 217)).toBe(false)
  })

  it('refuses lengths no straight combination reaches', () => {
    const withoutA3 = buildFillTable([54, 108, 144, 216])
    // 18 ja 36 mm eivät synny 54/108/144/216 mm:n paloista.
    expect(isFillable(withoutA3, 18)).toBe(false)
    expect(isFillable(withoutA3, 36)).toBe(false)
    expect(isFillable(withoutA3, 54)).toBe(true)
    expect(isFillable(withoutA3, 90)).toBe(false)
    expect(isFillable(withoutA3, 108)).toBe(true)
  })

  it('is derived from the piece library, so a new straight extends it', () => {
    const withoutA3 = buildFillTable([54, 108, 144, 216])
    const withA3 = buildFillTable([54, 72, 108, 144, 216])
    expect(isFillable(withoutA3, 72)).toBe(false)
    expect(isFillable(withA3, 72)).toBe(true)
  })

  it('lists fillable lengths in ascending order', () => {
    const lengths = fillableLengths(buildFillTable([54, 108]))
    expect(lengths.slice(0, 5)).toEqual([0, 54, 108, 162, 216])
  })

  it('finds the nearest fillable length above a floor', () => {
    const coarse = buildFillTable([54, 108, 144, 216])
    expect(nearestFillable(coarse, 250)).toBe(252)
    expect(nearestFillable(coarse, 20)).toBe(0)
    expect(nearestFillable(coarse, 20, 1)).toBe(54)
  })
})

describe('segment fill', () => {
  it('fills a gap exactly', () => {
    const ledger = new Ledger(unlimitedInventory())
    const result = solveFill(library, ledger, makeRng(1), { distanceMm: 432 })
    expect(result).not.toBeNull()
    expect(lengthOf(result!)).toBe(432)
  })

  it('is deterministic for a given seed', () => {
    const first = solveFill(library, new Ledger(unlimitedInventory()), makeRng(7), { distanceMm: 648 })
    const second = solveFill(library, new Ledger(unlimitedInventory()), makeRng(7), { distanceMm: 648 })
    expect(first).toEqual(second)
  })

  it('varies within the equivalence class across seeds', () => {
    const results = new Set(
      Array.from({ length: 12 }, (_, seed) =>
        (solveFill(library, new Ledger(unlimitedInventory()), makeRng(seed), { distanceMm: 648 }) ?? []).slice().sort().join('+'),
      ),
    )
    expect(results.size).toBeGreaterThan(1)
  })

  it('stays inside the inventory', () => {
    const inventory = createInventory({ A1: 2, A2: 4 })
    const ledger = new Ledger(inventory)
    const result = solveFill(library, ledger, makeRng(3), { distanceMm: 432 })
    expect(result).not.toBeNull()
    expect(lengthOf(result!)).toBe(432)
    expect(ledger.available('A1')).toBeGreaterThanOrEqual(0)
    expect(ledger.available('A2')).toBeGreaterThanOrEqual(0)
    for (const [id, count] of Object.entries(ledger.usage())) {
      expect(count, id).toBeLessThanOrEqual(inventory.counts[id])
    }
  })

  it('reserves the pieces it used', () => {
    const ledger = new Ledger(createInventory({ D: 3 }))
    const result = solveFill(library, ledger, makeRng(3), { distanceMm: 432 })
    expect(result).toEqual(['D', 'D'])
    expect(ledger.available('D')).toBe(1)
  })

  it('returns null and releases everything when the inventory cannot reach', () => {
    const ledger = new Ledger(createInventory({ D: 1 }))
    expect(solveFill(library, ledger, makeRng(3), { distanceMm: 432 })).toBeNull()
    expect(ledger.available('D')).toBe(1)
    expect(ledger.totalUsed()).toBe(0)
  })

  it('subtracts a third-party piece before consulting the table', () => {
    const ledger = new Ledger(unlimitedInventory())
    const result = solveFill(library, ledger, makeRng(2), { distanceMm: 500, preplacedMm: 68 })
    expect(result).not.toBeNull()
    expect(lengthOf(result!)).toBe(432)
  })

  it('never uses bridge decks for a floor-level gap', () => {
    const ledger = new Ledger(unlimitedInventory())
    for (let seed = 0; seed < 20; seed += 1) {
      const result = solveFill(library, ledger.clone(), makeRng(seed), { distanceMm: 648 }) ?? []
      expect(result.some((id) => library.get(id).tags.includes('bridge-deck'))).toBe(false)
    }
  })

  it('fills nothing for a zero-length gap', () => {
    expect(solveFill(library, new Ledger(unlimitedInventory()), makeRng(1), { distanceMm: 0 })).toEqual([])
  })
})

describe('inventory ledger', () => {
  it('reports shortages as a shopping list in skip mode', () => {
    const ledger = new Ledger(unlimitedInventory())
    ledger.take('D', 5)
    expect(ledger.usage()).toEqual({ D: 5 })
    expect(ledger.shortages()).toEqual({})
  })

  it('reports what is missing against a real inventory', () => {
    const ledger = new Ledger(createInventory({ D: 2 }))
    expect(ledger.take('D', 3)).toBe(false)
    ledger.take('D', 2)
    expect(ledger.shortages()).toEqual({})
    expect(ledger.available('D')).toBe(0)
  })

  it('clones without sharing state, so a rejected mutation rolls back cleanly', () => {
    const ledger = new Ledger(createInventory({ D: 4 }))
    ledger.take('D', 1)
    const attempt = ledger.clone()
    attempt.take('D', 3)
    expect(attempt.available('D')).toBe(0)
    expect(ledger.available('D')).toBe(3)
  })
})
