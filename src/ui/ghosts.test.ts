import { describe, expect, it } from 'vitest'
import { defaultLibrary } from '../core/library'
import { placeAtFrame, startFrame, type PlacedPiece } from '../core/pieces'
import { AREA, buildChain } from '../edit/section.test'
import { extendTrack } from '../edit'
import { branchChoice } from './drawing'
import { ghostAt, distinctPieces } from './ghosts'
import { ghostsOf } from './drawing'
import type { Ghost, Point } from './state'

const library = defaultLibrary()

/** Yksi pala kehykseen: testihaamut kootaan käsin, jotta geometria on tiedossa. */
function place(id: string, x: number, y: number, dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7): PlacedPiece {
  const result = placeAtFrame(library.get(id), startFrame(x, y, dir, 0, 'pin'))
  if (!result) throw new Error(`could not place ${id}`)
  return result.placed
}

function ghost(index: number, pieces: PlacedPiece[], tag: Point): Ghost {
  return { index, pieces, tag }
}

/**
 * Vika, jonka nämä testit estävät: haamut piirretään päällekkäin, joten DOM:n
 * "päällimmäinen" oli aina viimeksi piirretty. Nimilappu lupasi yhden vaihteen
 * ja radalle tuli toinen (docs/BRANCHING.md).
 */
const shared = place('D', 0, 0, 0)

describe('ghostAt', () => {
  it('answers with the ghost the finger pointed at, not the one drawn last', () => {
    // Kaksi haamua: sama suora, eri haara. Ensimmäinen haarautuu ylös,
    // toinen alas — ja jälkimmäinen piirretään päälle.
    const up = ghost(0, [shared, place('D', 216, 0, 6)], { x: 216, y: -108 })
    const down = ghost(1, [shared, place('D', 216, 0, 2)], { x: 216, y: 108 })

    expect(ghostAt([up, down], library, { x: 240, y: -150 })).toEqual({ kind: 'option', index: 0 })
    expect(ghostAt([up, down], library, { x: 240, y: 150 })).toEqual({ kind: 'option', index: 1 })
  })

  it('is not fooled by the order the ghosts are given in', () => {
    const up = ghost(0, [shared, place('D', 216, 0, 6)], { x: 216, y: -108 })
    const down = ghost(1, [shared, place('D', 216, 0, 2)], { x: 216, y: 108 })
    const swapped = [
      { ...down, index: 0 },
      { ...up, index: 1 },
    ]
    expect(ghostAt(swapped, library, { x: 240, y: -150 })).toEqual({ kind: 'option', index: 1 })
  })

  it('does not guess on the part every option shares', () => {
    // Vaihtoehdot lähtevät samasta kohdasta: siellä napautus ei ole valinta.
    const up = ghost(0, [shared, place('D', 216, 0, 6)], { x: 216, y: -108 })
    const down = ghost(1, [shared, place('D', 216, 0, 2)], { x: 216, y: 108 })
    expect(ghostAt([up, down], library, { x: 100, y: 0 })).toEqual({ kind: 'ambiguous' })
  })

  it('reads a tap far from every ghost as cancelling the question', () => {
    const up = ghost(0, [shared, place('D', 216, 0, 6)], { x: 216, y: -108 })
    const down = ghost(1, [shared, place('D', 216, 0, 2)], { x: 216, y: 108 })
    expect(ghostAt([up, down], library, { x: 100, y: 900 })).toEqual({ kind: 'miss' })
  })

  it('lets the number tag win: it is the aiming point', () => {
    const up = ghost(0, [shared, place('D', 216, 0, 6)], { x: 216, y: -108 })
    const down = ghost(1, [shared, place('D', 216, 0, 2)], { x: 216, y: 108 })
    // Lapun kohta on kummankin haaran lähellä, mutta lappu ratkaisee.
    expect(ghostAt([up, down], library, { x: 216, y: -100 })).toEqual({ kind: 'option', index: 0 })
  })

  it('answers a single ghost anywhere on it: there is nothing to confuse it with', () => {
    const only = ghost(0, [shared], { x: 108, y: 0 })
    expect(ghostAt([only], library, { x: 20, y: 20 })).toEqual({ kind: 'option', index: 0 })
  })
})

describe('distinctPieces', () => {
  it('drops what the options have in common and keeps what tells them apart', () => {
    const up = ghost(0, [shared, place('D', 216, 0, 6)], { x: 216, y: -108 })
    const down = ghost(1, [shared, place('D', 216, 0, 2)], { x: 216, y: 108 })

    for (const index of [0, 1]) {
      const own = distinctPieces([up, down], index)
      expect(own).toHaveLength(1)
      expect(own[0]).not.toEqual(shared)
    }
  })

  it('falls back to the whole ghost when nothing is its own', () => {
    const a = ghost(0, [shared], { x: 108, y: 0 })
    const b = ghost(1, [shared], { x: 108, y: 0 })
    expect(distinctPieces([a, b], 0)).toHaveLength(1)
  })
})

describe('the real branch question on the map', () => {
  /**
   * Sama kysymys kuin lattialla: kohtisuora veto pitkältä suoralta antaa
   * useamman vaihteen, ja niiden haamut ovat kartalla lähes päällekkäin. Jokaisen
   * on oltava napautettavissa siksi mikä se on.
   */
  it('gives every option a point of its own where its tap is unambiguous', () => {
    const track = buildChain(Array.from({ length: 8 }, () => ({ id: 'D' })))
    const start = { x: 600 + 216 * 3.5, y: 600 }
    const points = Array.from({ length: 31 }, (_, i) => ({ x: start.x, y: start.y + (700 * i) / 30 }))
    const result = extendTrack(track, points, { area: AREA, maxOptions: 3 })
    expect(result.options.length).toBeGreaterThan(1)

    const ghosts = ghostsOf(branchChoice(result.options, points).options)
    for (const target of ghosts) {
      // Numerolappu on jokaisen vaihtoehdon oma tähtäyspiste, ja se on aina
      // sen omalla ketjulla.
      expect(ghostAt(ghosts, library, target.tag)).toEqual({ kind: 'option', index: target.index })
    }
  })
})
