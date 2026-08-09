import { describe, expect, it } from 'vitest'
import { createInventory, unlimitedInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { seedFromInput } from '../core/rng'
import { MICRO_GRID_MM } from '../core/units'
import { DEFAULT_FLEX } from '../core/vario'
import { countCollisions } from './build'
import { generate, type GenerateOptions } from './generate'
import type { AreaShape } from './mask'

const library = defaultLibrary()
const LIVING_ROOM: AreaShape = { kind: 'rect', widthMm: 2000, depthMm: 1500 }

function run(options: Partial<GenerateOptions> & { seed: string | number }) {
  return generate({ area: LIVING_ROOM, ...options })
}

/**
 * Tiivis sormenjälki radasta: palat sijoituksineen. Golden-seed-testit lukitsevat
 * tämän, jotta tunnetut siemenet tuottavat pysyvästi saman radan.
 */
function fingerprint(pieces: { pieceId: string; placement: { x: number; y: number; rot: number; mirror: boolean; level: number } }[]): string {
  let hash = 0x811c9dc5
  const text = pieces
    .map((p) => `${p.pieceId}@${p.placement.x.toFixed(2)},${p.placement.y.toFixed(2)},${p.placement.rot},${p.placement.mirror ? 1 : 0},${p.placement.level}`)
    .join('|')
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${pieces.length}:${(hash >>> 0).toString(36)}`
}

describe('generation pipeline', () => {
  it('produces a track for an ordinary living-room floor', () => {
    const result = run({ seed: 'olohuone' })
    expect(result.winner, result.rejections.join(', ')).not.toBeNull()
    expect(result.winner!.track.pieces.length).toBeGreaterThan(10)
    expect(result.winner!.track.lengthMm).toBeGreaterThan(2000)
  })

  it('scores every candidate and picks the best', () => {
    const result = run({ seed: 'olohuone', candidates: 6 })
    expect(result.candidates.length).toBeGreaterThan(1)
    const best = Math.max(...result.candidates.map((c) => c.score.total))
    expect(result.winner!.score.total).toBe(best)
  })

  it('derives candidate seeds from the master seed (R4)', () => {
    const result = run({ seed: 'olohuone', candidates: 5 })
    expect(result.masterSeed).toBe(seedFromInput('olohuone'))
    expect(new Set(result.candidates.map((c) => c.seed)).size).toBe(result.candidates.length)
    expect(result.candidates.every((c) => c.seed !== result.masterSeed)).toBe(true)
  })

  it('closes every accepted loop inside the Vario budget', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const result = run({ seed })
      if (!result.winner) continue
      const closure = result.winner.track.closure
      expect(closure.withinBudget, seed).toBe(true)
      expect(closure.withinCaps, seed).toBe(true)
      expect(closure.shortfallMm, seed).toBe(0)
      expect(closure.tightnessPct, seed).toBeLessThanOrEqual(100)
    }
  })

  it('never accepts a track that collides with itself or leaves the floor', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const result = run({ seed })
      if (!result.winner) continue
      const track = result.winner.track
      expect(track.collisions, seed).toBe(0)
      expect(track.fitsArea, seed).toBe(true)
      expect(countCollisions(track.pieces, library, track.joints), seed).toBe(0)
      expect(track.bbox.minX, seed).toBeGreaterThanOrEqual(0)
      expect(track.bbox.maxX, seed).toBeLessThanOrEqual(LIVING_ROOM.widthMm)
    }
  })

  it('keeps every straight run on the 18 mm micro grid', () => {
    const result = run({ seed: 'grid' })
    for (const run of result.winner!.skeleton.runsMm) {
      expect(run % MICRO_GRID_MM).toBe(0)
    }
  })

  it('handles an L-shaped floor', () => {
    const result = generate({
      seed: 'kulma',
      area: { kind: 'L', widthMm: 2600, depthMm: 2000, cutWidthMm: 800, cutDepthMm: 700, corner: 'ne' },
    })
    expect(result.winner, result.rejections.join(', ')).not.toBeNull()
  })

  it('reports honestly when the floor is too small instead of inventing a track', () => {
    const result = generate({ seed: 'pieni', area: { kind: 'rect', widthMm: 400, depthMm: 400 } })
    expect(result.winner).toBeNull()
    expect(result.rejections.every((reason) => reason === 'area-too-small')).toBe(true)
  })
})

describe('determinism', () => {
  it('gives the same track for the same seed and settings', () => {
    const a = run({ seed: 'sama' })
    const b = run({ seed: 'sama' })
    expect(fingerprint(a.winner!.track.pieces)).toBe(fingerprint(b.winner!.track.pieces))
    expect(a.winner!.score.total).toBe(b.winner!.score.total)
  })

  it('accepts a numeric seed and a text seed alike', () => {
    expect(run({ seed: 12345 }).winner).not.toBeNull()
    expect(run({ seed: 'kaisan rata' }).winner).not.toBeNull()
  })

  it('gives different tracks for different seeds', () => {
    const prints = new Set(['a', 'b', 'c', 'd'].map((seed) => fingerprint(run({ seed }).winner!.track.pieces)))
    expect(prints.size).toBeGreaterThan(1)
  })

  it('changes the track when a setting changes', () => {
    const base = run({ seed: 'asetus' })
    const wider = generate({ seed: 'asetus', area: { kind: 'rect', widthMm: 2600, depthMm: 1500 } })
    expect(fingerprint(base.winner!.track.pieces)).not.toBe(fingerprint(wider.winner!.track.pieces))
  })

  it('holds known seeds to the exact same track (golden seeds)', () => {
    // Nämä arvot lukitsevat koko putken: reitti, elementtivalinnat, mutaatiot,
    // täyttö ja pisteytys. Jos jokin näistä muuttuu, testi kaatuu tarkoituksella.
    const golden: Record<string, string> = {
      olohuone: '45:rpcxsm',
      matto: '45:1w9qf2z',
      'kaisan rata': '50:18biq1s',
    }
    for (const [seed, expected] of Object.entries(golden)) {
      const result = run({ seed })
      expect(fingerprint(result.winner!.track.pieces), seed).toBe(expected)
    }
  })
})

describe('inventory', () => {
  it('never uses more pieces than the inventory holds', () => {
    const counts = { E: 8, E1: 4, A2: 4, A1: 4, A: 4, D: 6 }
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const result = run({ seed, inventory: createInventory(counts) })
      if (!result.winner) continue
      for (const [id, used] of Object.entries(result.winner.track.usage)) {
        expect(used, `${seed} ${id}`).toBeLessThanOrEqual(counts[id as keyof typeof counts] ?? 0)
      }
      expect(result.winner.track.shortages).toEqual({})
    }
  })

  it('scales the loop down to what the inventory can build', () => {
    const small = run({ seed: 'a', inventory: createInventory({ E: 8, A1: 4, A: 2, D: 2 }) })
    const large = run({ seed: 'a', inventory: unlimitedInventory() })
    expect(small.winner, small.rejections.join(', ')).not.toBeNull()
    expect(small.winner!.track.lengthMm).toBeLessThan(large.winner!.track.lengthMm)
  })

  it('produces a shopping list in skip mode', () => {
    const result = run({ seed: 'ostos', inventory: unlimitedInventory() })
    expect(Object.keys(result.winner!.track.usage).length).toBeGreaterThan(2)
    expect(result.winner!.track.shortages).toEqual({})
  })

  it('reports a rejection reason when the inventory is hopeless', () => {
    const result = run({ seed: 'tyhja', inventory: createInventory({ A2: 2 }) })
    expect(result.winner).toBeNull()
    expect(result.rejections.length).toBeGreaterThan(0)
  })
})

describe('mutations', () => {
  it('records why a mutation was rejected instead of breaking the track', () => {
    const result = run({ seed: 'mutaatio', mutationsPerCandidate: 8 })
    const outcomes = result.candidates.flatMap((c) => c.mutations)
    expect(outcomes.length).toBeGreaterThan(0)
    for (const outcome of outcomes) {
      if (!outcome.applied) expect(outcome.reason).toBeTruthy()
    }
    // Rata on ehjä riippumatta siitä, mitkä mutaatiot menivät läpi.
    expect(result.winner!.track.closure.ok).toBe(true)
  })

  it('rejects branch and crossing mutations cleanly while those pieces are missing', () => {
    const result = run({ seed: 'haara', mutationsPerCandidate: 12 })
    const blocked = result.candidates
      .flatMap((c) => c.mutations)
      .filter((m) => ['shortcut', 'extra-loop', 'overpass', 'x-crossing'].includes(m.id))
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.every((m) => !m.applied)).toBe(true)
    expect(blocked.every((m) => m.reason === 'no-branch-element' || m.reason === 'no-crossing-element')).toBe(true)
  })

  it('builds hills with strictly correct connector genders, no adapter setting needed', () => {
    const result = run({ seed: 'maki', mutationsPerCandidate: 10 })
    const withHill = result.candidates.filter((c) => c.mutations.some((m) => m.id === 'hill' && m.applied))
    expect(withHill.length).toBeGreaterThan(0)
    expect(Math.max(...withHill.map((c) => c.track.maxLevel))).toBe(1)
    for (const candidate of withHill) {
      // Sukupuolenvaihtajat kuuluvat mäkeen, eivät yleiseen täyttöön.
      expect(candidate.track.usage.N).toBeGreaterThan(0)
      expect(candidate.track.usage.C2).toBe(candidate.track.usage.B2)
    }
  })

  it('drops sidings with buffer stops onto straight runs', () => {
    const result = run({ seed: 'sivuraide', mutationsPerCandidate: 10 })
    const withSiding = result.candidates.filter((c) => c.mutations.some((m) => m.id === 'siding' && m.applied))
    expect(withSiding.length).toBeGreaterThan(0)
    for (const candidate of withSiding) {
      const usedSwitch = ['L', 'M', 'O1', 'P1'].some((id) => (candidate.track.usage[id] ?? 0) > 0)
      expect(usedSwitch).toBe(true)
      expect(candidate.track.usage.R).toBeGreaterThan(0)
      expect(candidate.track.closure.ok).toBe(true)
      expect(candidate.track.collisions).toBe(0)
    }
  })

  it('keeps the loop closed after every accepted mutation', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const result = run({ seed, mutationsPerCandidate: 10, allowConnectorFlip: true })
      for (const candidate of result.candidates) {
        expect(candidate.track.closure.ok, seed).toBe(true)
        expect(candidate.track.collisions, seed).toBe(0)
      }
    }
  })
})

describe('settings', () => {
  it('closes more loops when the flex piece is enabled', () => {
    const tight = { stretchPerJointMm: 0.2, bendPerJointDeg: 0.3, maxStretchPerJointMm: 0.3, maxBendPerJointDeg: 0.5 }
    const withoutFlex = run({ seed: 'jousto', vario: tight })
    const withFlex = run({ seed: 'jousto', vario: tight, flex: { ...DEFAULT_FLEX, count: 2 } })
    expect(withoutFlex.candidates.length).toBeLessThanOrEqual(withFlex.candidates.length)
    expect(withFlex.winner, 'flex piece should rescue at least one candidate').not.toBeNull()
  })

  it('exposes the seed in the form that goes into the URL', () => {
    const result = run({ seed: 'jaettava' })
    expect(result.seedLabel).toMatch(/^[0-9A-Z]{7}$/)
    expect(generate({ seed: result.seedLabel, area: LIVING_ROOM }).masterSeed).toBe(result.masterSeed)
  })
})
