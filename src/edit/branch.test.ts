import { describe, expect, it } from 'vitest'
import { buildFillTable, type FillTable } from '../core/fill'
import { createInventory, unlimitedInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { entryFrame, exitFrame, placedPorts } from '../core/pieces'
import { complementOf } from '../core/ports'
import type { Vec } from '../core/vec'
import type { Track } from '../gen/build'
import { buildLoop } from './section.test'
import { branchAnchors, branchingPieces, insertIntoRun, pieceCore, type BranchAnchor } from './branch'
import { naturalSection } from './section'

const library = defaultLibrary()

const table: FillTable = buildFillTable(library.fillerStraights().map((piece) => piece.straightLengthMm as number))

/** Suoran osuuden keskikohta maailmakoordinaatistossa. */
function pointOnPiece(track: Track, index: number): Vec {
  const placed = track.pieces[index]
  const piece = library.get(placed.pieceId)
  const entry = entryFrame(placed, piece)
  const exit = exitFrame(placed, piece)
  return { x: (entry.x + exit.x) / 2, y: (entry.y + exit.y) / 2 }
}

/** Radan nimellispituus: haaran lisääminen ei saa muuttaa sitä muualta kuin haaran osalta. */
function loopLength(track: Track, extra: readonly number[] = []): number {
  return track.pieces.reduce((sum, placed) => sum + library.get(placed.pieceId).lengthMm, 0) + extra.length
}

describe('branchingPieces', () => {
  it('takes every piece with a branch port from the library, not a hardcoded list', () => {
    const ids = branchingPieces(library).map((piece) => piece.id)
    expect(ids).toEqual(expect.arrayContaining(['L', 'M', 'O', 'P', 'O1', 'P1', 'I', 'T', 'X']))
  })

  it('leaves out plain crossings: their second track is not a switch', () => {
    const ids = branchingPieces(library).map((piece) => piece.id)
    expect(ids).not.toContain('H')
    expect(ids).not.toContain('H1')
    expect(ids).not.toContain('H2')
  })

  it('leaves out pieces whose measurements have not been checked', () => {
    const ids = branchingPieces(library).map((piece) => piece.id)
    expect(ids).not.toContain('F')
    expect(ids).not.toContain('G')
  })
})

describe('insertIntoRun', () => {
  it('keeps the run exactly as long as it was', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')
    const piece = library.get('L')

    const inserted = insertIntoRun(
      track,
      library,
      table,
      unlimitedInventory(),
      section,
      pieceCore(library, 'L', { entryPortId: 'in', exitPortId: 'out' }),
      400,
    )
    if (!inserted) throw new Error('no insertion')

    // Osuuden pituus säilyy, joten koko radan pituus muuttuu vain vaihteen ja
    // sen korvaamien suorien erotuksen verran — eli ei lainkaan geometriassa.
    const before = track.pieces.reduce((sum, placed) => sum + library.get(placed.pieceId).lengthMm, 0)
    const after = inserted.pieces.reduce((sum, placed) => sum + library.get(placed.pieceId).lengthMm, 0)
    expect(after).toBeCloseTo(before, 6)
    expect(inserted.pieces[inserted.coreStart].pieceId).toBe(piece.id)
  })

  it('leaves the rest of the track untouched', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')
    const outside = track.pieces.filter((_, index) => !section.indices.includes(index))

    const inserted = insertIntoRun(
      track,
      library,
      table,
      unlimitedInventory(),
      section,
      pieceCore(library, 'L', { entryPortId: 'in', exitPortId: 'out' }),
      0,
    )
    if (!inserted) throw new Error('no insertion')

    for (const placed of outside) {
      expect(inserted.pieces).toContainEqual(placed)
    }
  })

  it('slides the switch to the asked-for spot, snapped to a piece boundary', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    const near = insertIntoRun(track, library, table, unlimitedInventory(), section, pieceCore(library, 'L', { entryPortId: 'in', exitPortId: 'out' }), 0)
    const far = insertIntoRun(track, library, table, unlimitedInventory(), section, pieceCore(library, 'L', { entryPortId: 'in', exitPortId: 'out' }), 600)
    expect(near?.alongMm).toBe(0)
    expect(far?.alongMm).toBeGreaterThan(400)
  })

  it('gives up cleanly when the collection has no switch to spare', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')
    const inventory = createInventory({ D: 16, E: 8 })

    const inserted = insertIntoRun(
      track,
      library,
      table,
      inventory,
      section,
      pieceCore(library, 'L', { entryPortId: 'in', exitPortId: 'out' }),
      0,
    )
    expect(inserted).toBeNull()
  })
})

describe('branchAnchors', () => {
  it('finds branch points on a straight run', () => {
    const track = buildLoop()
    const anchors = branchAnchors(track, library, table, unlimitedInventory(), pointOnPiece(track, 1))
    expect(anchors.length).toBeGreaterThan(0)
    expect(anchors.every((anchor) => anchor.kind === 'run')).toBe(true)
  })

  it('offers an open port a plain chain can actually attach to', () => {
    const track = buildLoop()
    for (const anchor of branchAnchors(track, library, table, unlimitedInventory(), pointOnPiece(track, 1))) {
      // Ketju kulkee kolo -> tappi, joten haaraportin on tarjottava tappi.
      expect(complementOf(anchor.frame.open)).toBe('socket')
      const port = placedPorts(anchor.pieces[anchor.junctionIndex], library.get(anchor.junctionId)).find(
        (candidate) => candidate.id === anchor.portId,
      )
      expect(port).toBeDefined()
      expect(Math.hypot((port as { x: number }).x - anchor.frame.x, (port as { y: number }).y - anchor.frame.y)).toBeLessThan(1e-6)
    }
  })

  it('swaps a rigid curve for a branching piece of the same port signature', () => {
    // E1-kaari kuuluu samaan korvausluokkaan kuin O/P, jotka haarautuvat.
    const track = buildLoop(['E1', 'E1', 'E1', 'E1', 'E1', 'E1', 'E1', 'E1'])
    const anchors = branchAnchors(track, library, table, unlimitedInventory(), pointOnPiece(track, 0))
    const swaps = anchors.filter((anchor) => anchor.kind === 'swap')
    expect(swaps.length).toBeGreaterThan(0)
    expect(swaps.map((anchor) => anchor.junctionId)).toEqual(expect.arrayContaining(['O']))
  })

  it('leaves a swapped curve ending in exactly the same port', () => {
    const track = buildLoop(['E1', 'E1', 'E1', 'E1', 'E1', 'E1', 'E1', 'E1'])
    const swaps = branchAnchors(track, library, table, unlimitedInventory(), pointOnPiece(track, 0)).filter(
      (anchor) => anchor.kind === 'swap',
    )
    expect(swaps.length).toBeGreaterThan(0)
    for (const anchor of swaps) {
      const original = track.pieces[anchor.junctionIndex]
      const before = exitFrame(original, library.get(original.pieceId))
      const swapped = anchor.pieces[anchor.junctionIndex]
      const after = exitFrame(swapped, library.get(swapped.pieceId))
      expect(after.dir).toBe(before.dir)
      expect(after.open).toBe(before.open)
      expect(after.level).toBe(before.level)
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.2)
    }
  })

  it('branches from the straights around a curve when the curve itself cannot take one', () => {
    // E-kaaren korvausluokassa ei ole haaroittavaa palaa, joten haara on
    // haettava mutkaa ympäröiviltä suorilta (README luku 5).
    const track = buildLoop()
    const curve = 4
    expect(library.get(track.pieces[curve].pieceId).kind).toBe('curve')
    const anchors = branchAnchors(track, library, table, unlimitedInventory(), pointOnPiece(track, curve))
    expect(anchors.length).toBeGreaterThan(0)
    expect(anchors.every((anchor) => anchor.kind === 'run')).toBe(true)
  })

  it('says nothing at all when the point is far from the track', () => {
    const track = buildLoop()
    const anchors = branchAnchors(track, library, table, unlimitedInventory(), { x: 2800, y: 2200 })
    expect(anchors).toEqual([])
  })

  it('prefers the branch point nearest the finger', () => {
    const track = buildLoop()
    const point = pointOnPiece(track, 1)
    const anchors = branchAnchors(track, library, table, unlimitedInventory(), point)
    const best = anchors[0] as BranchAnchor
    expect(best.offsetMm).toBeLessThan(300)
  })

  it('is deterministic: the same point gives the same branch points', () => {
    const track = buildLoop()
    const point = pointOnPiece(track, 1)
    const first = branchAnchors(track, library, table, unlimitedInventory(), point)
    const second = branchAnchors(track, library, table, unlimitedInventory(), point)
    expect(second.map((anchor) => `${anchor.junctionId}.${anchor.portId}`)).toEqual(
      first.map((anchor) => `${anchor.junctionId}.${anchor.portId}`),
    )
  })

  it('does not use pieces the collection does not have', () => {
    const track = buildLoop()
    const inventory = createInventory({ D: 16, A: 2, A1: 2, A2: 4, E: 8, M: 1 })
    const anchors = branchAnchors(track, library, table, inventory, pointOnPiece(track, 1))
    expect(anchors.length).toBeGreaterThan(0)
    expect(new Set(anchors.map((anchor) => anchor.junctionId))).toEqual(new Set(['M']))
  })

  it('leaves the original track untouched', () => {
    const track = buildLoop()
    const before = loopLength(track)
    branchAnchors(track, library, table, unlimitedInventory(), pointOnPiece(track, 1))
    expect(loopLength(track)).toBe(before)
    expect(track.pieces).toHaveLength(24)
  })
})
