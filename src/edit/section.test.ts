import { describe, expect, it } from 'vitest'
import { defaultLibrary } from '../core/library'
import { placeAtFrame, startFrame, type PlacedPiece } from '../core/pieces'
import { evaluateClosure, jointsForChain } from '../core/vario'
import { summariseTrack, type Track } from '../gen/build'
import { generate } from '../gen/generate'
import { areaBounds, buildMask, type AreaShape } from '../gen/mask'
import {
  handlePoint,
  makeSection,
  naturalSection,
  neighbourLists,
  sectionBrief,
  slideCandidates,
  slideSectionEnd,
} from './section'

const library = defaultLibrary()
export const AREA: AreaShape = { kind: 'rect', widthMm: 3000, depthMm: 2400 }

/**
 * Testirata: pyöristetty suorakaide, jonka jokainen sivu on neljä D-suoraa ja
 * jokainen kulma kaksi E-kaarta. Silmukka sulkeutuu eksaktisti, joten portit
 * osuvat päällekkäin eikä testi mittaa sulkeutumisjäännöstä.
 */
const SIDE = ['D', 'D', 'D', 'D']
const CORNER = ['E', 'E']
export const LOOP_IDS = [...SIDE, ...CORNER, ...SIDE, ...CORNER, ...SIDE, ...CORNER, ...SIDE, ...CORNER]

export function buildLoop(ids: readonly string[] = LOOP_IDS): Track {
  let cursor = startFrame(500, 500, 0, 0, 'pin')
  const pieces: PlacedPiece[] = []
  for (const id of ids) {
    const result = placeAtFrame(library.get(id), cursor)
    if (!result) throw new Error(`could not place ${id}`)
    pieces.push(result.placed)
    cursor = result.exit
  }

  const joints: [number, number][] = []
  for (let i = 1; i < pieces.length; i += 1) joints.push([i - 1, i])
  joints.push([pieces.length - 1, 0])

  const resolved = pieces.map((placed) => library.get(placed.pieceId))
  const usage: Record<string, number> = {}
  for (const placed of pieces) usage[placed.pieceId] = (usage[placed.pieceId] ?? 0) + 1

  return summariseTrack(
    {
      pieces,
      joints,
      closure: evaluateClosure(jointsForChain(resolved, true), { gapMm: 0, angleDeg: 0 }),
      usage,
      shortages: {},
      areaBounds: areaBounds(buildMask(AREA)),
    },
    library,
  )
}

describe('naturalSection', () => {
  it('selects the whole run of straights around the tapped piece', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)

    // Sivu on neljä D-suoraa, ja jakso katkeaa kummassakin päässä kaareen.
    expect(section?.indices).toEqual([0, 1, 2, 3])
    expect(section?.replaceable).toBe(true)
  })

  it('stops at a curve: tapping a hard piece selects just that piece', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 4)

    expect(section?.indices).toEqual([4])
    expect(library.get(track.pieces[4].pieceId).kind).toBe('curve')
  })

  it('fixes the end frames at the ports the neighbours are attached to', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    // Alkupää on edeltävän kaaren ulostulossa, loppupää seuraavan sisääntulossa.
    expect(section.before).toBe(track.pieces.length - 1)
    expect(section.after).toBe(4)
    expect(section.start.level).toBe(0)
    expect(section.end.level).toBe(0)
    // Neljä D-suoraa vievät 864 mm suoraan eteenpäin.
    expect(Math.hypot(section.end.x - section.start.x, section.end.y - section.start.y)).toBeCloseTo(864, 6)
    expect(section.end.dir).toBe(section.start.dir)
  })

  it('refuses a selection that covers the whole track', () => {
    const track = buildLoop()
    const section = makeSection(track, library, track.pieces.map((_, index) => index))

    expect(section?.replaceable).toBe(false)
  })

  // Oikeassa generoidussa radassa on sivuraiteita, ja niiden vaihde on juuri se
  // pala jota ei voi korvata: purkaminen jättäisi haaran roikkumaan irralleen.
  it('refuses a piece that has a branch hanging off it', () => {
    const track = generate({ seed: 'A', area: { kind: 'rect', widthMm: 2400, depthMm: 1800 } }).winner?.track
    if (!track) throw new Error('no track')

    const branching = neighbourLists(track).findIndex((list) => list.length > 2)
    expect(branching).toBeGreaterThanOrEqual(0)

    const section = naturalSection(track, library, branching)
    expect(section?.indices).toEqual([branching])
    expect(section?.replaceable).toBe(false)
  })

  it('selects a replaceable run of straights from a generated track', () => {
    const track = generate({ seed: 'A', area: { kind: 'rect', widthMm: 2400, depthMm: 1800 } }).winner?.track
    if (!track) throw new Error('no track')

    const straight = track.pieces.findIndex((placed) => library.get(placed.pieceId).kind === 'straight')
    const section = naturalSection(track, library, straight)

    expect(section?.replaceable).toBe(true)
    expect(section?.indices).toContain(straight)
    expect(section?.before).not.toBeNull()
    expect(section?.after).not.toBeNull()
  })
})

describe('sliding end handles', () => {
  it('snaps to piece boundaries along the track', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    const candidates = slideCandidates(track, library, section, 'end')
    // Kutistus kolmeen palaan asti ja kasvatus kaarien yli aina kahvarajaan.
    expect(candidates.map((candidate) => candidate.indices.length).sort((a, b) => a - b)[0]).toBe(1)
    expect(Math.max(...candidates.map((candidate) => candidate.indices.length))).toBeGreaterThan(4)
    // Jokainen ehdokas alkaa samasta portista: vain loppupää liikkuu.
    for (const candidate of candidates) expect(candidate.indices[0]).toBe(0)
  })

  it('follows the finger to the nearest boundary and back', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    // Kahva vedetään kolmannen palan rajalle: osiosta jää kolme palaa.
    const shrunk = slideSectionEnd(track, library, section, 'end', handlePoint(makeSectionOf(track, [0, 1, 2]), 'end'))
    expect(shrunk.indices).toEqual([0, 1, 2])

    // ...ja takaisin alkuperäiseen kohtaan.
    const restored = slideSectionEnd(track, library, shrunk, 'end', handlePoint(section, 'end'))
    expect(restored.indices).toEqual([0, 1, 2, 3])
  })

  it('grows over a curve, which turns the end port', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    const grown = slideCandidates(track, library, section, 'end').find((candidate) => candidate.indices.length === 6)
    expect(grown?.indices).toEqual([0, 1, 2, 3, 4, 5])
    // Kahden kaaren yli venytetty valinta kääntää päätyportin neljänneskierroksen.
    expect(grown?.end.dir).toBe((section.start.dir + 2) % 8)
  })

  function makeSectionOf(track: Track, indices: number[]) {
    const section = makeSection(track, library, indices)
    if (!section) throw new Error('no section')
    return section
  }
})

describe('sectionBrief', () => {
  it('reports the task: length, level, free space and the pieces it frees', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    const brief = sectionBrief(track, library, AREA, section)

    expect(brief.pieceCount).toBe(4)
    expect(brief.lengthMm).toBeCloseTo(864, 6)
    expect(brief.level).toBe(0)
    expect(brief.freed).toEqual({ D: 4 })
    // Sivutila on kummallakin puolella positiivinen mutta rajallinen: toisella
    // puolella lattian reuna, toisella silmukan vastakkainen sivu.
    expect(brief.leftMm).toBeGreaterThan(0)
    expect(brief.rightMm).toBeGreaterThan(0)
    expect(Math.min(brief.leftMm, brief.rightMm)).toBeLessThan(648)
  })

  it('measures the corridor towards the loop centre, not through the neighbours', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    const brief = sectionBrief(track, library, AREA, section)
    // Silmukan sisäpuoli on ~864 mm leveä; vapaa käytävä on se miinus laudan
    // leveys, eli reilusti alle mittauskaton mutta selvästi yli puoli metriä.
    const inner = Math.max(brief.leftMm, brief.rightMm)
    expect(inner).toBeGreaterThan(500)
  })
})
