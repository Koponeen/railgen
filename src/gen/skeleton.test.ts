import { describe, expect, it } from 'vitest'
import { buildFillTable } from '../core/fill'
import { Ledger, unlimitedInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { makeRng } from '../core/rng'
import { MICRO_GRID_MM } from '../core/units'
import { materialise } from './build'
import { buildElementLibrary, bundledElementSpecs } from './elements'
import { buildMask } from './mask'
import { MUTATIONS } from './mutate'
import { growCycle } from './route'
import { balanceRuns, buildSkeleton, cloneSkeleton, skeletonGapMm, unitOf, type Skeleton } from './skeleton'

const library = defaultLibrary()
const elements = buildElementLibrary(bundledElementSpecs(), library, new Ledger(unlimitedInventory()))
const table = buildFillTable(
  library
    .straights()
    .filter((piece) => !piece.tags.includes('bridge-deck'))
    .map((piece) => piece.straightLengthMm as number),
)
const mask = buildMask({ kind: 'rect', widthMm: 2000, depthMm: 1500 })

function skeletonFor(seed: number): Skeleton {
  const cycle = growCycle(mask, makeRng(seed))
  const skeleton = buildSkeleton(cycle!, mask, elements, table, new Ledger(unlimitedInventory()), makeRng(seed))
  if (!skeleton) throw new Error(`no skeleton for seed ${seed}`)
  return skeleton
}

/**
 * Sulkeutumisvirhe suoraan rungon geometriasta: osuudet kulkusuuntaansa plus
 * kulmien sisään- ja ulostulomitat. Suljetun kierroksen pitäisi summautua
 * nollaan jäännöstä lukuun ottamatta.
 */
function analyticClosure(skeleton: Skeleton): { x: number; y: number } {
  const count = skeleton.corners.length
  const total = { x: 0, y: 0 }
  for (let i = 0; i < count; i += 1) {
    const inDir = unitOf(skeleton.legDirs[(i - 1 + count) % count])
    const outDir = unitOf(skeleton.legDirs[i])
    total.x += skeleton.corners[i].alongMm * inDir.x + skeleton.corners[i].acrossMm * outDir.x
    total.y += skeleton.corners[i].alongMm * inDir.y + skeleton.corners[i].acrossMm * outDir.y
    total.x += skeleton.runsMm[i] * outDir.x
    total.y += skeleton.runsMm[i] * outDir.y
  }
  return total
}

describe('skeleton', () => {
  it('turns a cell route into corners and straight runs', () => {
    const skeleton = skeletonFor(1)
    expect(skeleton.corners.length).toBeGreaterThanOrEqual(4)
    expect(skeleton.runsMm).toHaveLength(skeleton.corners.length)
    expect(skeleton.legLengthsMm.every((length) => length % 216 === 0)).toBe(true)
  })

  it('rounds every run onto the 18 mm micro grid', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      for (const run of skeletonFor(seed).runsMm) {
        expect(run % MICRO_GRID_MM, `seed ${seed}`).toBe(0)
        expect(run).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('reports a residual that matches the geometry it describes', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const skeleton = skeletonFor(seed)
      const closure = analyticClosure(skeleton)
      expect(closure.x, `seed ${seed} x`).toBeCloseTo(skeleton.residual.x, 6)
      expect(closure.y, `seed ${seed} y`).toBeCloseTo(skeleton.residual.y, 6)
    }
  })

  it('agrees with the gap the materialised track actually has', () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const skeleton = skeletonFor(seed)
      const track = materialise(
        skeleton,
        { library, elements, table, mask },
        new Ledger(unlimitedInventory()),
        makeRng(seed),
      )
      expect(track, `seed ${seed}`).not.toBeNull()
      expect(track!.closure.error.gapMm, `seed ${seed}`).toBeCloseTo(skeletonGapMm(skeleton), 6)
      // Kaikki kulmat ovat 90 asteen monikertoja, joten suunta sulkeutuu tarkasti.
      expect(track!.closure.error.angleDeg, `seed ${seed}`).toBe(0)
    }
  })

  it('keeps the residual small enough for Vario to absorb', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      // Täytettävät pituudet ovat harvassa lähellä nollaa, joten jäännös voi
      // olla kymmeniä millejä — budjetin riittävyys tarkistetaan erikseen.
      expect(skeletonGapMm(skeletonFor(seed)), `seed ${seed}`).toBeLessThan(80)
    }
  })

  it('is deterministic', () => {
    expect(skeletonFor(5)).toEqual(skeletonFor(5))
  })
})

describe('run balancing', () => {
  it('re-solves the runs after a corner is swapped for a different radius', () => {
    const skeleton = skeletonFor(2)
    const swapped = cloneSkeleton(skeleton)
    const other = elements.get(skeleton.corners[0].elementId === 'corner-e' ? 'corner-e1' : 'corner-e')
    swapped.corners[0] = { ...swapped.corners[0], elementId: other.id, alongMm: other.alongMm, acrossMm: other.acrossMm }
    balanceRuns(swapped, table)

    expect(swapped.runsMm).not.toEqual(skeleton.runsMm)
    const closure = analyticClosure(swapped)
    expect(closure.x).toBeCloseTo(swapped.residual.x, 6)
    expect(closure.y).toBeCloseTo(swapped.residual.y, 6)
  })
})

describe('mutations preserve the invariants', () => {
  const context = { elements, table, allowConnectorFlip: true }

  it('leaves the closure residual untouched when only lengths move', () => {
    const shift = MUTATIONS.find((mutation) => mutation.id === 'shift-length')!
    for (let seed = 0; seed < 20; seed += 1) {
      const skeleton = skeletonFor(seed)
      const result = shift.apply(skeleton, context, makeRng(seed))
      if (!result.ok) continue
      // Pituutta siirretään akselin sisällä pareittain, joten summa säilyy.
      expect(analyticClosure(result.skeleton).x, `seed ${seed} x`).toBeCloseTo(analyticClosure(skeleton).x, 6)
      expect(analyticClosure(result.skeleton).y, `seed ${seed} y`).toBeCloseTo(analyticClosure(skeleton).y, 6)
      expect(result.skeleton.runsMm).not.toEqual(skeleton.runsMm)
    }
  })

  it('never mutates the skeleton it was given', () => {
    for (const mutation of MUTATIONS) {
      const skeleton = skeletonFor(4)
      const before = JSON.stringify(skeleton)
      mutation.apply(skeleton, context, makeRng(9))
      expect(JSON.stringify(skeleton), mutation.id).toBe(before)
    }
  })

  it('keeps a hill inside the run it replaces', () => {
    const hill = MUTATIONS.find((mutation) => mutation.id === 'hill')!
    for (let seed = 0; seed < 20; seed += 1) {
      const skeleton = skeletonFor(seed)
      const result = hill.apply(skeleton, context, makeRng(seed))
      if (!result.ok) continue
      for (const [index, elementId] of Object.entries(result.skeleton.hills)) {
        expect(elements.get(elementId).alongMm).toBeLessThanOrEqual(result.skeleton.runsMm[Number(index)])
      }
    }
  })

  it('refuses a hill without the connector-flip setting', () => {
    const hill = MUTATIONS.find((mutation) => mutation.id === 'hill')!
    const result = hill.apply(skeletonFor(1), { elements, table }, makeRng(1))
    expect(result).toEqual({ ok: false, reason: 'requires-connector-flip' })
  })
})
