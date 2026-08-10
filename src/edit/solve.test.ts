import { describe, expect, it } from 'vitest'
import { createInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { generate } from '../gen/generate'
import { AREA, buildLoop } from './section.test'
import { makeSection, naturalSection, sectionBrief } from './section'
import { solveSection } from './solve'

const library = defaultLibrary()

function runSection(track: ReturnType<typeof buildLoop>) {
  const section = naturalSection(track, library, 1)
  if (!section) throw new Error('no section')
  return section
}

describe('solveSection', () => {
  it('offers a handful of ready answers to the section brief', () => {
    const track = buildLoop()
    const options = solveSection(track, runSection(track), { area: AREA })

    expect(options.length).toBeGreaterThan(1)
    expect(options.length).toBeLessThanOrEqual(3)
    for (const option of options) {
      expect(option.track.pieces.length).toBeGreaterThan(0)
      expect(Object.keys(option.added).length).toBeGreaterThan(0)
      expect(option.addedIndices.length).toBeGreaterThan(0)
    }
  })

  it('offers each pattern type only once: two similar ghosts are not a choice', () => {
    const track = buildLoop()
    const options = solveSection(track, runSection(track), { area: AREA, maxOptions: 8 })
    expect(new Set(options.map((option) => option.family)).size).toBe(options.length)
  })

  it('keeps the rest of the track exactly where it was', () => {
    const track = buildLoop()
    const section = runSection(track)
    const outside = track.pieces.filter((_, index) => !section.indices.includes(index))

    for (const option of solveSection(track, section, { area: AREA, maxOptions: 8 })) {
      for (const placed of outside) expect(option.track.pieces).toContainEqual(placed)
      // Läpimenevä matka säilyy, joten rata ei lyhene. Se voi silti pidentyä:
      // sivuraide ja ohituskaide ovat rataa siinä missä muukin, ja ne lasketaan
      // keskilinjasummaan mukaan.
      expect(option.track.lengthMm).toBeGreaterThan(track.lengthMm - 40)
    }
  })

  it('ranks the cheapest first', () => {
    const track = buildLoop()
    const costs = solveSection(track, runSection(track), { area: AREA, maxOptions: 8 }).map((option) => option.cost)
    expect([...costs].sort((a, b) => a - b)).toEqual(costs)
  })

  it('writes the piece change card for every option', () => {
    const track = buildLoop()
    for (const option of solveSection(track, runSection(track), { area: AREA, maxOptions: 8 })) {
      // Osuus purkautuu neljäksi D:ksi, ja kuvio kertoo mitä tilalle menee.
      expect(option.removed).toEqual({ D: 4 })
      expect(Object.keys(option.added).length).toBeGreaterThan(0)
    }
  })

  it('respects the collection: nothing is offered that cannot be built', () => {
    const track = buildLoop()
    const section = runSection(track)
    // Kokoelmassa on tasan radan verran paloja eikä yhtään vaihdetta, joten
    // vain purettavista D:istä koottavat kuviot ovat mahdollisia.
    const inventory = createInventory({ D: 16, E: 8 })
    for (const option of solveSection(track, section, { area: AREA, inventory, maxOptions: 8 })) {
      expect(option.withinInventory).toBe(true)
      expect(option.track.shortages).toEqual({})
    }
  })

  it('does not offer a pattern that needs more side room than the section has', () => {
    const track = buildLoop()
    const section = runSection(track)
    const brief = sectionBrief(track, library, AREA, section)

    for (const option of solveSection(track, section, { area: AREA, maxOptions: 8 })) {
      if (option.kind !== 'variation') continue
      // Kuvio mahtuu käytävään: kartalla se ei siis törmää mihinkään eikä
      // valu lattian ulkopuolelle.
      expect(option.track.collisions).toBeLessThanOrEqual(track.collisions)
      expect(brief.leftMm + brief.rightMm).toBeGreaterThan(0)
    }
  })

  it('offers piece swaps for a single-piece section', () => {
    const track = buildLoop()
    const section = makeSection(track, library, [0])
    if (!section) throw new Error('no section')
    const options = solveSection(track, section, { area: AREA, maxOptions: 8 })
    expect(options.some((option) => option.kind === 'swap')).toBe(true)
    expect(options.some((option) => option.kind === 'variation')).toBe(true)
  })

  it('says nothing for a section that cannot be replaced', () => {
    const track = buildLoop()
    const whole = makeSection(track, library, track.pieces.map((_, index) => index))
    if (!whole) throw new Error('no section')
    expect(solveSection(track, whole, { area: AREA })).toEqual([])
  })

  it('is deterministic: the same section gives the same options in the same order', () => {
    const track = buildLoop()
    const section = runSection(track)
    const first = solveSection(track, section, { area: AREA, maxOptions: 8 })
    const second = solveSection(track, section, { area: AREA, maxOptions: 8 })
    expect(second.map((option) => `${option.id}:${option.cost}`)).toEqual(first.map((option) => `${option.id}:${option.cost}`))
  })

  it('leaves the original track untouched', () => {
    const track = buildLoop()
    const before = track.pieces.map((placed) => `${placed.pieceId}@${placed.placement.x.toFixed(2)}`).join()
    solveSection(track, runSection(track), { area: AREA, maxOptions: 8 })
    expect(track.pieces.map((placed) => `${placed.pieceId}@${placed.placement.x.toFixed(2)}`).join()).toBe(before)
  })

  it('works on a generated track, not just a hand-built loop', () => {
    const area = { kind: 'rect' as const, widthMm: 2400, depthMm: 1800 }
    const track = generate({ seed: 'A', area }).winner?.track
    if (!track) throw new Error('no track')

    const straight = track.pieces.findIndex((placed) => library.get(placed.pieceId).kind === 'straight')
    const section = naturalSection(track, library, straight)
    if (!section) throw new Error('no section')

    const options = solveSection(track, section, { area })
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) expect(option.track.collisions).toBeLessThanOrEqual(track.collisions)
  })
})
