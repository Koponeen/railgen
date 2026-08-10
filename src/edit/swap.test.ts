import { describe, expect, it } from 'vitest'
import { createInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { entryFrame, exitFrame } from '../core/pieces'
import { signaturesMatch } from '../core/ports'
import { AREA, buildChain, buildLoop } from './section.test'
import { jointHolds, makeSection, naturalSection } from './section'
import { swapOptions } from './swap'

const library = defaultLibrary()

function sectionOf(track: ReturnType<typeof buildLoop>, indices: number[]) {
  const section = makeSection(track, library, indices)
  if (!section) throw new Error('no section')
  return section
}

describe('swapping a piece something is attached to', () => {
  it('offers a plain straight for a three-way switch: their main ports are the same', () => {
    // Korvausluokka tulee pääporteista, joten kolmisuuntaisen vaihteen tilalle
    // kelpaa suora. Haaraportti katoaa, ja siihen liitetty haara jää irralleen.
    const track = buildChain([{ id: 'D' }, { id: 'I' }, { id: 'D' }])
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')
    const ids = swapOptions(track, section, { area: AREA }).map((option) => option.toId)
    expect(ids).toContain('A')
  })

  it('drops the joint the swap breaks instead of keeping it in the books', () => {
    // Haara on kiinni vaihteen haaraportissa. Suoralla ei ole sellaista, joten
    // liitoksen on kadottava — kartta ei saa väittää kiinnitystä jota ei ole.
    const track = buildChain([{ id: 'D' }, { id: 'I' }, { id: 'D' }])
    const branched: typeof track = {
      ...track,
      pieces: [...track.pieces],
      joints: [...track.joints],
    }
    const section = naturalSection(branched, library, 1)
    if (!section) throw new Error('no section')

    const swapped = swapOptions(branched, section, { area: AREA }).find((option) => option.toId === 'A')
    if (!swapped) throw new Error('no straight swap')
    // Jokainen jäljelle jäänyt liitos on aito porttipari.
    for (const [a, b] of swapped.track.joints) {
      expect(jointHolds(swapped.track.pieces, library, a, b)).toBe(true)
    }
  })
})

describe('swapOptions', () => {
  it('offers the same port signature, straight from the piece library', () => {
    const track = buildLoop()
    const options = swapOptions(track, sectionOf(track, [0]), { area: AREA })

    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      expect(option.fromId).toBe('D')
      expect(signaturesMatch(library.get(option.toId).signatures, library.get('D').signatures)).toBe(true)
    }
    // D:n korvausluokka on README luvun 2 taulukossa: T ja X ovat siinä.
    expect(options.map((option) => option.toId)).toEqual(expect.arrayContaining(['T', 'X']))
  })

  it('lands in exactly the same end port, so the rest of the track does not move', () => {
    const track = buildLoop()
    const original = track.pieces[0]
    const before = exitFrame(original, library.get(original.pieceId))

    for (const option of swapOptions(track, sectionOf(track, [0]), { area: AREA })) {
      const swapped = option.track.pieces[0]
      const after = exitFrame(swapped, library.get(swapped.pieceId))
      expect(after.dir).toBe(before.dir)
      expect(after.level).toBe(before.level)
      expect(after.open).toBe(before.open)
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.2)
      // Sisääntulo on sekin sama: pala vaihtuu paikallaan.
      const entry = entryFrame(swapped, library.get(swapped.pieceId))
      expect(Math.hypot(entry.x - before.x, entry.y - before.y)).toBeGreaterThan(0)
      expect(option.track.pieces).toHaveLength(track.pieces.length)
    }
  })

  it('writes the piece change card: one out, one in', () => {
    const track = buildLoop()
    for (const option of swapOptions(track, sectionOf(track, [0]), { area: AREA })) {
      expect(option.removed).toEqual({ D: 1 })
      expect(option.added).toEqual({ [option.toId]: 1 })
      expect(option.addedIndices).toEqual([0])
    }
  })

  it('says nothing for a curve whose class has no other piece', () => {
    // E:n korvausluokassa on vain E itse (H3-kaariristeystä ei ole kirjastossa).
    const track = buildLoop()
    expect(library.get(track.pieces[4].pieceId).kind).toBe('curve')
    expect(swapOptions(track, sectionOf(track, [4]), { area: AREA })).toEqual([])
  })

  it('offers the branching pieces of a tight curve class', () => {
    // E1:n korvausluokkaan kuuluvat O ja P (README luku 2).
    const track = buildLoop(Array.from({ length: 8 }, () => 'E1'))
    const options = swapOptions(track, sectionOf(track, [0]), { area: AREA })
    expect(options.map((option) => option.toId)).toEqual(expect.arrayContaining(['O']))
  })

  it('marks a piece the collection does not have but still offers it', () => {
    const track = buildLoop()
    const options = swapOptions(track, sectionOf(track, [0]), { area: AREA, inventory: createInventory({ D: 16, E: 8 }) })

    expect(options.length).toBeGreaterThan(0)
    expect(options.every((option) => !option.withinInventory)).toBe(true)
    // Puuttuva pala on kelvollinen vaihtoehto muttei koskaan ensimmäinen.
    const owned = swapOptions(track, sectionOf(track, [0]), { area: AREA })
    expect(options[0].cost).toBeGreaterThan(owned[0].cost)
  })

  it('refuses a multi-piece section: that is what the variations are for', () => {
    const track = buildLoop()
    const section = naturalSection(track, library, 1)
    if (!section) throw new Error('no section')
    expect(section.indices.length).toBeGreaterThan(1)
    expect(swapOptions(track, section, { area: AREA })).toEqual([])
  })

  it('leaves the original track untouched', () => {
    const track = buildLoop()
    const before = track.pieces.map((placed) => placed.pieceId).join()
    swapOptions(track, sectionOf(track, [0]), { area: AREA })
    expect(track.pieces.map((placed) => placed.pieceId).join()).toBe(before)
  })
})
