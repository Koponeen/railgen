import { describe, expect, it } from 'vitest'
import { createInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { generate } from '../gen/generate'
import { AREA, buildChain, buildLoop } from './section.test'
import { fillGap, removeSection } from './remove'
import { makeSection, naturalSection, neighbourLists } from './section'

const library = defaultLibrary()

describe('removeSection at a free end', () => {
  /**
   * Radan päässä ei ole aukkoa vaan kiskonpää, joka siirtyy taaksepäin. Ilman
   * tätä eroa piirretyn haaran päätä ei saanut poistettua lainkaan: koodi luki
   * vapaan pään porttipariksi ja tarjosi vain aukon täyttämistä takaisin.
   */
  const CHAIN = [{ id: 'D' }, { id: 'D' }, { id: 'E' }, { id: 'D' }, { id: 'D' }]

  it('leaves no gap to answer: the removal is the answer', () => {
    const track = buildChain(CHAIN)
    const section = naturalSection(track, library, 4)
    if (!section) throw new Error('no section')
    expect(section.after).toBeNull()

    const removed = removeSection(track, section, { area: AREA })
    expect(removed.reason).toBe('ok')
    expect(removed.gap).toBeNull()
    expect(removed.track?.pieces.length).toBe(track.pieces.length - section.indices.length)
  })

  it('gives back the pieces it took off', () => {
    const track = buildChain(CHAIN)
    const section = naturalSection(track, library, 4)
    if (!section) throw new Error('no section')
    const removed = removeSection(track, section, { area: AREA })
    expect(removed.track?.usage.D).toBe((track.usage.D ?? 0) - 2)
  })

  it('refuses to delete the whole track: the board has its own button', () => {
    const track = buildChain(CHAIN)
    const section = makeSection(track, library, track.pieces.map((_, index) => index))
    if (!section) throw new Error('no section')
    expect(removeSection(track, section, { area: AREA }).reason).toBe('section-not-removable')
  })

  it('still asks about a gap in the middle of the track', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')
    expect(removeSection(track, section, { area: AREA }).gap).not.toBeNull()
  })
})

describe('removeSection', () => {
  it('leaves a gap marked by the two end ports', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    const removed = removeSection(track, section, { area: AREA })
    expect(removed.reason).toBe('ok')
    expect(removed.track?.pieces).toHaveLength(track.pieces.length - section.indices.length)
    expect(removed.gap?.start).toEqual(section.start)
    expect(removed.gap?.end).toEqual(section.end)
    expect(removed.gap?.lengthMm).toBeCloseTo(864, 6)
    expect(removed.gap?.freed).toEqual({ D: 4 })
  })

  it('does not join the open ends to each other', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    const removed = removeSection(track, section, { area: AREA })
    if (!removed.track) throw new Error('no track')
    // Aukon kummallakin puolella on pala, jolla on vain yksi naapuri: juuri se
    // tekee aukosta aukon eikä lyhyemmän silmukan.
    const openEnds = neighbourLists(removed.track).filter((list) => list.length === 1)
    expect(openEnds).toHaveLength(2)
  })

  it('removes a switch even when a branch hangs off it, leaving the branch loose', () => {
    // Poisto ei kokoa mitään tilalle, joten haara ei ole este: se jää lattialle
    // irralleen, aivan kuten oikeasti kävisi. Palojen on lähdettävä radalta
    // aina — muuten poistonappi ei poista mitään.
    const area = { kind: 'rect' as const, widthMm: 2400, depthMm: 1800 }
    const track = generate({ seed: 'A', area }).winner?.track
    if (!track) throw new Error('no track')

    const branching = neighbourLists(track).findIndex((list) => list.length > 2)
    const section = naturalSection(track, library, branching)
    if (!section) throw new Error('no section')

    const removed = removeSection(track, section, { area })
    expect(removed.reason).toBe('ok')
    expect(removed.track?.pieces.length).toBe(track.pieces.length - section.indices.length)
    // Haaran palat ovat yhä kartalla, mutta poistetun palan liitokset ovat poissa.
    for (const [a, b] of removed.track?.joints ?? []) {
      expect(a).toBeLessThan(removed.track?.pieces.length ?? 0)
      expect(b).toBeLessThan(removed.track?.pieces.length ?? 0)
    }
  })

  it('refuses to remove the whole track', () => {
    const track = buildLoop()
    const section = makeSection(track, library, track.pieces.map((_, index) => index))
    if (!section) throw new Error('no section')
    expect(removeSection(track, section, { area: AREA }).reason).toBe('section-not-removable')
  })

  it('leaves the original track untouched', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')
    removeSection(track, section, { area: AREA })
    expect(track.pieces).toHaveLength(24)
  })
})

describe('fillGap', () => {
  it('fills the gap with straights from end port to end port', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    const filled = fillGap(track, section, { area: AREA })
    expect(filled.reason).toBe('ok')
    expect(filled.removed).toEqual({ D: 4 })
    // Solverin vastaus voi olla eri paloista kuin alkuperäinen, mutta matkan on
    // oltava sama: osuuden pituus ei muutu, joten muu rata ei liiku.
    const length = (counts: Record<string, number>) =>
      Object.entries(counts).reduce((sum, [id, count]) => sum + library.get(id).lengthMm * count, 0)
    expect(length(filled.added)).toBeCloseTo(864, 6)
    expect(filled.track?.lengthMm).toBeCloseTo(track.lengthMm, 6)
  })

  it('fills within the collection, counting the pieces the gap freed', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')

    // Kokoelmassa on tasan radan verran paloja: täyttö onnistuu vain jos
    // purettu osio palauttaa omansa takaisin hyllyyn.
    const filled = fillGap(track, section, { area: AREA, inventory: createInventory({ D: 16, E: 8 }) })
    expect(filled.reason).toBe('ok')
    expect(filled.added).toEqual({ D: 4 })
    expect(filled.withinInventory).toBe(true)
  })

  it('says so honestly when the ends are not on the same line', () => {
    const track = buildLoop()
    const bent = makeSection(track, library, [2, 3, 4, 5, 6])
    if (!bent) throw new Error('no section')
    // Valinta on venytetty mutkan yli, joten suorista ei saa täyttöä.
    expect(bent.end.dir).not.toBe(bent.start.dir)
    expect(fillGap(track, bent, { area: AREA }).reason).toBe('no-fill')
  })

  it('is deterministic: the same gap gets the same answer', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')
    expect(fillGap(track, section, { area: AREA }).added).toEqual(fillGap(track, section, { area: AREA }).added)
  })

  it('leaves the original track untouched', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')
    const before = track.pieces.map((placed) => `${placed.pieceId}@${placed.placement.x.toFixed(2)}`).join()
    fillGap(track, section, { area: AREA })
    expect(track.pieces.map((placed) => `${placed.pieceId}@${placed.placement.x.toFixed(2)}`).join()).toBe(before)
  })
})
