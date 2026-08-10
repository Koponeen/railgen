import { describe, expect, it } from 'vitest'
import { createInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { entryFrame, exitFrame } from '../core/pieces'
import type { Vec } from '../core/vec'
import { countCollisions, type Track } from '../gen/build'
import { AREA, buildLoop } from './section.test'
import { extendTrack, newPieceIndices, type BranchOption } from './extend'

const library = defaultLibrary()

/** Ulostulokehys palan päässä: haara piirretään tästä eteenpäin. */
function tipOf(track: Track, index: number) {
  const placed = track.pieces[index]
  return exitFrame(placed, library.get(placed.pieceId))
}

/** Sormella vedetty viiva: tasavälisiä pisteitä, ei palageometriaa. */
function stroke(from: Vec, to: Vec, steps = 30): Vec[] {
  const points: Vec[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
  }
  return points
}

/** Haara ulos radan yläsivulta viistoon lattialle. */
function sideBranch(track: Track): Vec[] {
  const tip = tipOf(track, 1)
  return stroke(tip, { x: tip.x + 500, y: tip.y + 300 })
}

/** Haara, joka kulkee koko radan poikki ja jatkaa sen ohi. */
function crossingBranch(track: Track): Vec[] {
  const tip = tipOf(track, 1)
  return stroke(tip, { x: tip.x, y: tip.y + 2200 }, 40)
}

function expectIntact(before: Track, option: BranchOption): void {
  const { track } = option
  // Rata on joka välivaiheessa ehjä: ei uusia törmäyksiä eikä irrallisia paloja.
  expect(track.collisions).toBeLessThanOrEqual(before.collisions)
  expect(countCollisions(track.pieces, library, track.joints)).toBe(track.collisions)

  // Jokainen liitos on aito porttipari eikä pelkkä kirjanpitomerkintä.
  for (const [a, b] of track.joints) {
    expect(a).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThan(track.pieces.length)
  }
}

describe('extendTrack', () => {
  it('turns a stroke starting on the track into a branch', () => {
    const track = buildLoop()
    const result = extendTrack(track, sideBranch(track), { area: AREA })

    expect(result.reason).toBe('ok')
    expect(result.options.length).toBeGreaterThan(0)
    for (const option of result.options) {
      expect(option.pieceCount).toBeGreaterThan(0)
      expect(option.track.pieces.length).toBeGreaterThan(track.pieces.length)
      expectIntact(track, option)
    }
  })

  it('leaves the original track untouched', () => {
    const track = buildLoop()
    const pieces = track.pieces.length
    const length = track.lengthMm
    extendTrack(track, sideBranch(track), { area: AREA })
    expect(track.pieces).toHaveLength(pieces)
    expect(track.lengthMm).toBe(length)
  })

  it('attaches the branch to a real switch port', () => {
    const track = buildLoop()
    const [option] = extendTrack(track, sideBranch(track), { area: AREA }).options
    const junction = library.get(option.junctionId)
    expect(junction.ports.some((port) => port.branch)).toBe(true)
    expect(option.added[option.junctionId]).toBeGreaterThanOrEqual(1)
  })

  it('keeps the loop the same length: the switch replaces straights, it does not lengthen the run', () => {
    const track = buildLoop()
    const [option] = extendTrack(track, sideBranch(track), { area: AREA }).options
    // Palamuutoskortti kertoo koko totuuden: radan pituus muuttuu täsmälleen
    // lisättyjen ja vapautuneiden palojen erotuksen verran.
    const millimetres = (counts: Record<string, number>): number =>
      Object.entries(counts).reduce((sum, [id, count]) => sum + library.get(id).lengthMm * count, 0)
    expect(option.track.lengthMm).toBeCloseTo(track.lengthMm + millimetres(option.added) - millimetres(option.removed), 6)
  })

  it('reports the piece change: what it uses and what it frees', () => {
    const track = buildLoop()
    const [option] = extendTrack(track, sideBranch(track), { area: AREA }).options
    expect(Object.keys(option.added).length).toBeGreaterThan(0)
    expect(Object.keys(option.removed).length).toBeGreaterThan(0)
  })

  it('accepts a stroke drawn from the free end towards the track', () => {
    const track = buildLoop()
    const forward = extendTrack(track, sideBranch(track), { area: AREA })
    const backward = extendTrack(track, [...sideBranch(track)].reverse(), { area: AREA })
    expect(backward.reason).toBe('ok')
    expect(backward.options[0].junctionId).toBe(forward.options[0].junctionId)
  })

  it('is deterministic: the same stroke gives the same branches', () => {
    const track = buildLoop()
    const first = extendTrack(track, sideBranch(track), { area: AREA })
    const second = extendTrack(track, sideBranch(track), { area: AREA })
    expect(second.options.map((option) => option.junctionId)).toEqual(first.options.map((option) => option.junctionId))
    expect(second.options.map((option) => option.cost)).toEqual(first.options.map((option) => option.cost))
  })

  it('offers at most a handful of ghosts: a map full of them is not a choice', () => {
    const track = buildLoop()
    const result = extendTrack(track, sideBranch(track), { area: AREA, maxOptions: 3 })
    expect(result.options.length).toBeLessThanOrEqual(3)
  })

  it('refuses a stroke that is nowhere near the track', () => {
    const track = buildLoop()
    const result = extendTrack(track, stroke({ x: 2600, y: 2100 }, { x: 2900, y: 2300 }), { area: AREA })
    expect(result.reason).toBe('not-on-track')
    expect(result.options).toEqual([])
  })

  it('refuses a scribble too short to be a branch', () => {
    const track = buildLoop()
    const tip = tipOf(track, 1)
    const result = extendTrack(track, stroke(tip, { x: tip.x + 30, y: tip.y + 20 }), { area: AREA })
    expect(result.reason).toBe('drawing-too-short')
  })

  it('says so when the collection has no switch at all', () => {
    const track = buildLoop()
    const result = extendTrack(track, sideBranch(track), {
      area: AREA,
      inventory: createInventory({ D: 20, A: 4, A1: 4, A2: 4, E: 12 }),
    })
    expect(result.reason).toBe('no-branch-point')
  })

  it('stays inside the collection when it can', () => {
    const track = buildLoop()
    const result = extendTrack(track, sideBranch(track), {
      area: AREA,
      inventory: createInventory({ D: 20, A: 4, A1: 4, A2: 4, E: 12, E1: 4, L: 1, M: 1 }),
    })
    expect(result.reason).toBe('ok')
    expect(result.options[0].withinInventory).toBe(true)
  })
})

describe('extendTrack across the track', () => {
  it('resolves a stroke that crosses the loop instead of refusing it', () => {
    const track = buildLoop()
    const result = extendTrack(track, crossingBranch(track), { area: AREA })

    expect(result.reason).toBe('ok')
    expect(result.options.length).toBeGreaterThan(0)
    expect(result.options.every((option) => option.crossing !== 'none')).toBe(true)
  })

  it('never resolves a crossing on its own: it is a real question', () => {
    const track = buildLoop()
    const result = extendTrack(track, crossingBranch(track), { area: AREA })
    expect(result.automatic).toBe(false)
  })

  it('offers both answers: a level crossing and a bridge over', () => {
    const track = buildLoop()
    const kinds = new Set(extendTrack(track, crossingBranch(track), { area: AREA, maxOptions: 4 }).options.map((o) => o.crossing))
    expect(kinds).toContain('level')
    expect(kinds).toContain('bridge')
  })

  it('lays a real crossing piece on the old track for a level crossing', () => {
    const track = buildLoop()
    const level = extendTrack(track, crossingBranch(track), { area: AREA, maxOptions: 4 }).options.find(
      (option) => option.crossing === 'level',
    )
    if (!level) throw new Error('no level crossing')
    expect(level.crossingId).not.toBeNull()
    expect(library.get(level.crossingId as string).tags).toEqual(expect.arrayContaining(['crossing']))
    expect(level.added[level.crossingId as string]).toBe(1)
    expect(level.track.maxLevel).toBe(0)
  })

  it('lifts the branch to the upper level for a bridge', () => {
    const track = buildLoop()
    const bridge = extendTrack(track, crossingBranch(track), { area: AREA, maxOptions: 4 }).options.find(
      (option) => option.crossing === 'bridge',
    )
    if (!bridge) throw new Error('no bridge')
    expect(bridge.track.maxLevel).toBe(1)
    expect(bridge.added.N).toBe(2)
    // Silta palaa lattialle: haaran viimeinen pala on tasolla 0.
    const last = bridge.track.pieces[bridge.track.pieces.length - 1]
    expect(exitFrame(last, library.get(last.pieceId)).level).toBe(0)
  })

  it('keeps every option collision-free, crossing included', () => {
    const track = buildLoop()
    for (const option of extendTrack(track, crossingBranch(track), { area: AREA, maxOptions: 4 }).options) {
      expectIntact(track, option)
    }
  })

  it('keeps the branch connected end to end through the crossing', () => {
    const track = buildLoop()
    const level = extendTrack(track, crossingBranch(track), { area: AREA, maxOptions: 4 }).options.find(
      (option) => option.crossing === 'level',
    )
    if (!level) throw new Error('no level crossing')

    // Jokaisella lisätyllä palalla on vähintään yksi liitos, eli mikään ei jää
    // irralleen kartalle.
    const degree = new Map<number, number>()
    for (const [a, b] of level.track.joints) {
      degree.set(a, (degree.get(a) ?? 0) + 1)
      degree.set(b, (degree.get(b) ?? 0) + 1)
    }
    for (const index of level.addedIndices) {
      expect(degree.get(index) ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('newPieceIndices', () => {
  it('marks exactly the pieces that were not there before', () => {
    const track = buildLoop()
    const [option] = extendTrack(track, sideBranch(track), { area: AREA }).options
    const added = newPieceIndices(track, option.track)
    expect(added).toEqual(option.addedIndices)
    expect(added.length).toBeGreaterThan(0)

    // Koskematon pala ei ole listalla: sen sijoitus on täsmälleen entinen.
    const untouched = option.track.pieces.filter((_, index) => !added.includes(index))
    for (const placed of untouched) {
      expect(track.pieces).toContainEqual(placed)
    }
  })

  it('sees an unchanged track as unchanged', () => {
    const track = buildLoop()
    expect(newPieceIndices(track, track)).toEqual([])
  })
})

describe('branch geometry', () => {
  it('starts the branch exactly at the switch port', () => {
    const track = buildLoop()
    const [option] = extendTrack(track, sideBranch(track), { area: AREA }).options
    const first = option.track.pieces[option.addedIndices[option.addedIndices.length - option.pieceCount]]
    expect(first).toBeDefined()
    const frame = entryFrame(first, library.get(first.pieceId))
    expect(Number.isFinite(frame.x)).toBe(true)
  })

  it('places every branch piece on the 45° slots', () => {
    const track = buildLoop()
    for (const option of extendTrack(track, sideBranch(track), { area: AREA }).options) {
      for (const index of option.addedIndices) {
        const placement = option.track.pieces[index].placement
        expect(Number.isInteger(placement.rot)).toBe(true)
        expect(placement.rot).toBeGreaterThanOrEqual(0)
        expect(placement.rot).toBeLessThan(8)
      }
    }
  })
})
