import { describe, expect, it } from 'vitest'
import { createInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { samplePath } from '../core/path'
import { entryFrame, exitFrame, placedSegments } from '../core/pieces'
import type { Vec } from '../core/vec'
import type { Track } from '../gen/build'
import { generate } from '../gen/generate'
import { AREA, buildLoop } from './section.test'
import { naturalSection, neighbourLists, type Section } from './section'
import { availableInventory, replaceSection, splice } from './replace'

const library = defaultLibrary()

function sectionOf(track: Track, index = 1): Section {
  const section = naturalSection(track, library, index)
  if (!section) throw new Error('no section')
  return section
}

/** Osion oma keskilinja "sormenjälkenä": käyttäjä piirtää sen mitä siellä jo on. */
function traceSection(track: Track, section: Section): Vec[] {
  const points: Vec[] = []
  for (const index of section.indices) {
    const placed = track.pieces[index]
    for (const point of samplePath(placedSegments(placed, library.get(placed.pieceId)), 12)) {
      const previous = points[points.length - 1]
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.5) points.push(point)
    }
  }
  return points
}

/**
 * Sivusuuntainen pullistuma osion päästä päähän: sinikupu, jonka syvyys on
 * `depthMm`. Tämä on se mitä käyttäjä oikeasti piirtää — vapaalla kädellä
 * vedetty kaari, ei palageometriaa.
 */
function bulge(section: Section, depthMm: number, steps = 40): Vec[] {
  const dx = section.end.x - section.start.x
  const dy = section.end.y - section.start.y
  const length = Math.hypot(dx, dy)
  const normal = { x: -dy / length, y: dx / length }
  const points: Vec[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const hump = Math.sin(Math.PI * t) * depthMm
    points.push({
      x: section.start.x + dx * t + normal.x * hump,
      y: section.start.y + dy * t + normal.y * hump,
    })
  }
  return points
}

/** Osion päätyportit ovat kiinteät: uuden ketjun on osuttava niihin. */
function expectEndsHeld(before: Track, after: Track, section: Section): void {
  const newPieces = after.pieces.slice(before.pieces.length - section.indices.length)
  expect(newPieces.length).toBeGreaterThan(0)

  const first = entryFrame(newPieces[0], library.get(newPieces[0].pieceId))
  const last = exitFrame(newPieces[newPieces.length - 1], library.get(newPieces[newPieces.length - 1].pieceId))

  expect(first.dir).toBe(section.start.dir)
  expect(first.open).toBe(section.start.open)
  expect(first.level).toBe(section.start.level)
  expect(last.dir).toBe(section.end.dir)
  expect(last.open).toBe(section.end.open)
  expect(last.level).toBe(section.end.level)

  // Päätyliitoksiin jäävä heitto on Vario-budjetin sisällä, ei ammottava aukko.
  expect(Math.hypot(first.x - section.start.x, first.y - section.start.y)).toBeLessThan(6)
  expect(Math.hypot(last.x - section.end.x, last.y - section.end.y)).toBeLessThan(6)
}

describe('replaceSection', () => {
  it('rebuilds a section drawn over its own shape', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    const result = replaceSection(track, section, traceSection(track, section), { area: AREA })

    expect(result.reason).toBe('ok')
    expect(result.track).not.toBeNull()
    expect(result.deviation.maxMm).toBeLessThan(20)
    expectEndsHeld(track, result.track as Track, section)
    // Sama matka, ei välttämättä sama palajako: 4 x D voi olla 6 x A1.
    expect(result.track?.lengthMm).toBeCloseTo(track.lengthMm, 0)
  })

  it('turns a freehand bulge into pieces between the fixed ports', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    const result = replaceSection(track, section, bulge(section, 120), { area: AREA })

    expect(result.reason).toBe('ok')
    expectEndsHeld(track, result.track as Track, section)
    // Pullistuma vaatii kaaria: pelkillä suorilla siitä ei tule mitään.
    const curves = result.track?.pieces.filter((placed) => library.get(placed.pieceId).kind === 'curve') ?? []
    expect(curves.length).toBeGreaterThan(track.pieces.filter((p) => library.get(p.pieceId).kind === 'curve').length)
    // Kierros pitenee, koska se kiertää mutkan kautta.
    expect(result.track?.lengthMm).toBeGreaterThan(track.lengthMm)
  })

  it('keeps the rest of the track untouched', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    const result = replaceSection(track, section, bulge(section, 120), { area: AREA })
    const next = result.track as Track

    const kept = track.pieces.filter((_, index) => !section.indices.includes(index))
    expect(next.pieces.slice(0, kept.length)).toEqual(kept)
    expect(next.collisions).toBe(0)
    // Liitoksia on yhtä monta kuin paloja: silmukka on yhä ehjä.
    expect(next.joints).toHaveLength(next.pieces.length)
  })

  it('is deterministic: the same stroke always gives the same track', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    const points = bulge(section, 120)

    const first = replaceSection(track, section, points, { area: AREA })
    const second = replaceSection(track, section, points, { area: AREA })
    expect(second.track?.pieces).toEqual(first.track?.pieces)
  })

  it('accepts the stroke drawn from either end', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    const points = bulge(section, 120)

    const forward = replaceSection(track, section, points, { area: AREA })
    const backward = replaceSection(track, section, [...points].reverse(), { area: AREA })
    expect(backward.reason).toBe('ok')
    expect(backward.track?.pieces).toEqual(forward.track?.pieces)
  })

  it('spends the pieces the section frees', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    // Kokoelma riittää tasan tähän rataan: ilman purkautuvia paloja korvaus ei
    // mahtuisi inventaarioon lainkaan.
    const inventory = createInventory({ D: 16, E: 8 })

    expect(availableInventory(track, section, inventory).counts).toEqual({ D: 4, E: 0 })

    const result = replaceSection(track, section, traceSection(track, section), { area: AREA, inventory })
    expect(result.reason).toBe('ok')
    expect(result.withinInventory).toBe(true)
    expect(result.track?.shortages).toEqual({})
  })

  it('reports what is missing when the freed pieces are not enough', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    const inventory = createInventory({ D: 16, E: 8 })

    // Kupu on liian syvä suorilla oiottavaksi, ja kaikki kahdeksan kaarta ovat
    // jo kulmissa kiinni — tällöin rehellinen vastaus on puuttuvien lista.
    const result = replaceSection(track, section, bulge(section, 170), { area: AREA, inventory })
    expect(result.reason).toBe('ok')
    expect(result.withinInventory).toBe(false)
    expect(result.track?.shortages.E).toBeGreaterThan(0)
  })

  it('refuses a section it cannot replace instead of breaking the track', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    const whole = { ...section, replaceable: false }

    const result = replaceSection(track, whole, traceSection(track, section), { area: AREA })
    expect(result.reason).toBe('section-not-replaceable')
    expect(result.track).toBeNull()
  })

  it('refuses a stroke too short to be a shape', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    const result = replaceSection(track, section, [{ x: 500, y: 500 }, { x: 560, y: 500 }], { area: AREA })

    expect(result.reason).toBe('drawing-too-short')
    expect(result.track).toBeNull()
  })

  it('refuses a shape that cannot reach the fixed end port', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    // Syvä kupu kaartaa niin jyrkästi, ettei ketju enää palaa loppuporttiin.
    const result = replaceSection(track, section, bulge(section, 900), { area: AREA })

    expect(result.track).toBeNull()
    expect(['no-fit', 'ends-beyond-budget', 'self-collision']).toContain(result.reason)
  })
})

// Oikeassa radassa on sivuraiteita ja risteyksiä. Korvauksen on säilytettävä ne
// koskemattomina: uusi ketju vaihtaa vain osion ja sen kaksi päätyliitosta.
describe('replaceSection on a generated track', () => {
  const generated = generate({ seed: 'A', area: { kind: 'rect', widthMm: 2400, depthMm: 1800 } }).winner?.track

  it('keeps every branch attached', () => {
    if (!generated) throw new Error('no track')
    const straight = generated.pieces.findIndex((placed) => library.get(placed.pieceId).kind === 'straight')
    const section = naturalSection(generated, library, straight)
    if (!section?.replaceable) throw new Error('no replaceable section')

    const result = replaceSection(generated, section, traceSection(generated, section), {
      area: { kind: 'rect', widthMm: 2400, depthMm: 1800 },
    })
    const next = result.track as Track
    expect(result.reason).toBe('ok')

    // Yksikään pala ei jää irralleen: jokaisella on yhä vähintään yksi liitos,
    // ja haarautuvat palat ovat yhä haarautuvia.
    const degrees = new Array<number>(next.pieces.length).fill(0)
    for (const [a, b] of next.joints) {
      degrees[a] += 1
      degrees[b] += 1
    }
    expect(degrees.every((degree) => degree > 0)).toBe(true)
    expect(degrees.filter((degree) => degree > 2)).toHaveLength(
      neighbourLists(generated).filter((list) => list.length > 2).length,
    )
  })
})

describe('splice', () => {
  it('rewires the joints around the replacement chain', () => {
    const track = buildLoop()
    const section = sectionOf(track)
    const replacement = section.indices.map((index) => track.pieces[index])

    const spliced = splice(track, section, replacement)

    expect(spliced.pieces).toHaveLength(track.pieces.length)
    expect(spliced.joints).toHaveLength(track.joints.length)
    // Osion sisäiset liitokset ja molemmat päätyliitokset ovat paikallisia.
    expect(spliced.localJoints).toHaveLength(replacement.length + 1)
    for (const [a, b] of spliced.joints) {
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(spliced.pieces.length)
    }
  })
})
