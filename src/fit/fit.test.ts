import { describe, expect, it } from 'vitest'
import { createInventory, unlimitedInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { samplePath } from '../core/path'
import { placeAtFrame, placedSegments, startFrame, type Frame, type PlacedPiece } from '../core/pieces'
import type { AreaShape } from '../gen/mask'
import type { Vec } from '../core/vec'
import { fitDrawing } from './fit'
import { buildTarget } from './target'
import { cleanDrawing } from './simplify'

// Sovitusta testataan piirtämällä oikean palaketjun päälle: ketju rakennetaan
// kirjastosta, sen keskilinja näytteistetään "sormenjäljeksi", ja sovituksen
// pitää löytää takaisin samaan muotoon. Näin testi mittaa sovitusta eikä
// keksittyä geometriaa.

const library = defaultLibrary()
const AREA: AreaShape = { kind: 'rect', widthMm: 3000, depthMm: 2400 }

interface Chain {
  pieces: PlacedPiece[]
  points: Vec[]
  end: Frame
}

/** Rakentaa ketjun palatunnuksista ja näytteistää sen keskilinjan. */
function chain(ids: readonly (string | [string, 'mirror'])[], start = startFrame(400, 400, 0, 0, 'pin')): Chain {
  let cursor = start
  const pieces: PlacedPiece[] = []
  const points: Vec[] = []

  for (const entry of ids) {
    const [id, flag] = Array.isArray(entry) ? entry : [entry, undefined]
    const piece = library.get(id)
    const result = placeAtFrame(piece, cursor, { mirror: flag === 'mirror' })
    if (!result) throw new Error(`could not place ${id}`)
    pieces.push(result.placed)
    for (const point of samplePath(placedSegments(result.placed, piece), 12)) {
      const previous = points[points.length - 1]
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.5) points.push(point)
    }
    cursor = result.exit
  }

  return { pieces, points, end: cursor }
}

/** Sormen vapina: deterministinen, pieni ja RDP-toleranssin alle jäävä. */
function jitter(points: readonly Vec[], amplitudeMm = 6): Vec[] {
  return points.map((point, index) => ({
    x: point.x + Math.sin(index * 1.7) * amplitudeMm,
    y: point.y + Math.cos(index * 2.3) * amplitudeMm,
  }))
}

/** Ympyrä kahdeksasta 45°:n kaaresta on suljettu silmukka, joka sulkeutuu eksaktisti. */
const CIRCLE = ['E', 'E', 'E', 'E', 'E', 'E', 'E', 'E']

describe('fitDrawing', () => {
  it('follows a straight stroke with straight pieces', () => {
    const drawn = chain(['D', 'D', 'A'])
    const result = fitDrawing(drawn.points, { area: AREA })

    expect(result.reason).toBe('ok')
    expect(result.track).not.toBeNull()
    expect(result.closed).toBe(false)
    expect(result.deviation.maxMm).toBeLessThan(20)
    // Sama matka, ei välttämättä sama palajako: 1 x D voi olla 2 x A2 + A1.
    expect(result.track?.lengthMm).toBeCloseTo(576, 0)
    expect(result.track?.pieces.every((placed) => library.get(placed.pieceId).kind === 'straight')).toBe(true)
  })

  it('follows a curved stroke with curves', () => {
    const drawn = chain(['D', 'E', 'E', 'D'])
    const result = fitDrawing(drawn.points, { area: AREA })

    expect(result.reason).toBe('ok')
    expect(result.deviation.meanMm).toBeLessThan(15)
    const curves = result.track?.pieces.filter((placed) => library.get(placed.pieceId).kind === 'curve') ?? []
    expect(curves.length).toBeGreaterThanOrEqual(2)
  })

  it('absorbs finger tremor instead of following it', () => {
    const drawn = chain(['D', 'D', 'D'])
    const result = fitDrawing(jitter(drawn.points), { area: AREA })

    expect(result.reason).toBe('ok')
    // Sahalaita ei saa muuttua kaariksi: viiva on aikomus, ei komento.
    expect(result.track?.pieces.every((placed) => library.get(placed.pieceId).kind === 'straight')).toBe(true)
  })

  it('closes a drawn loop within the tolerance budget', () => {
    const drawn = chain(CIRCLE)
    const result = fitDrawing(drawn.points, { area: AREA })

    expect(result.closed).toBe(true)
    expect(result.reason).toBe('ok')
    expect(result.track?.closure.withinBudget).toBe(true)
    expect(result.track?.closure.withinCaps).toBe(true)
    // Suljetulla radalla liitoksia on yhtä monta kuin paloja.
    expect(result.track?.joints).toHaveLength(result.track?.pieces.length as number)
  })

  // Ellipsi ei ole BRIO-geometriaa: siinä ei ole 45°:n lokeroita eikä
  // gridipituuksia. Juuri tämän käyttäjä kuitenkin piirtää, joten sovituksen on
  // tuotettava siitä rakennettava silmukka — ei valitettava mahdottomuudesta.
  it('turns a freehand ellipse into a buildable loop', () => {
    const drawn: Vec[] = []
    for (let angle = 0; angle <= 360; angle += 3) {
      const rad = (angle * Math.PI) / 180
      drawn.push({
        x: 1200 + Math.cos(rad) * 600 + Math.sin(angle * 0.7) * 10,
        y: 900 + Math.sin(rad) * 450 + Math.cos(angle * 1.3) * 10,
      })
    }
    const result = fitDrawing(drawn, { area: { kind: 'rect', widthMm: 2400, depthMm: 1800 } })

    expect(result.reason).toBe('ok')
    expect(result.closed).toBe(true)
    expect(result.track?.closure.withinBudget).toBe(true)
    expect(result.track?.collisions).toBe(0)
    // Puoli laudanleveyttä keskimäärin on 45°-lokeroinnin rehellinen hinta.
    expect(result.deviation.meanMm).toBeLessThan(30)
    // Sauman suuntaheittoa ei voi jakaa liitoksille, joten se näkyisi mutkana.
    expect(result.track?.closure.error.angleDeg).toBe(0)
  })

  it('is deterministic: the same stroke always gives the same track', () => {
    const drawn = chain(['D', 'E', 'E', 'A', 'E'])
    const first = fitDrawing(drawn.points, { area: AREA })
    const second = fitDrawing(drawn.points, { area: AREA })

    expect(second.track?.pieces).toEqual(first.track?.pieces)
    expect(second.deviation).toEqual(first.deviation)
  })

  it('rejects a stroke that is too short to be a track', () => {
    const result = fitDrawing([{ x: 0, y: 0 }, { x: 80, y: 0 }], { area: AREA })
    expect(result.reason).toBe('drawing-too-short')
    expect(result.track).toBeNull()
  })

  it('stays inside the inventory when it can', () => {
    const drawn = chain(['D', 'D', 'D'])
    const result = fitDrawing(drawn.points, {
      area: AREA,
      inventory: createInventory({ A2: 4, A1: 4, A: 4, D: 4, E: 8 }),
    })

    expect(result.reason).toBe('ok')
    expect(result.withinInventory).toBe(true)
    expect(result.track?.shortages).toEqual({})
    for (const [id, count] of Object.entries(result.track?.usage ?? {})) {
      expect(count).toBeLessThanOrEqual({ A2: 4, A1: 4, A: 4, D: 4, E: 8 }[id as 'D'] ?? 0)
    }
  })

  it('reports what is missing when the inventory runs out', () => {
    const drawn = chain(CIRCLE)
    // Ympyrä vaatii kahdeksan kaarta; annetaan kaksi eikä yhtään suoraa,
    // joilla kaaren voisi korvata.
    const result = fitDrawing(drawn.points, { area: AREA, inventory: createInventory({ E: 2 }) })

    expect(result.reason).toBe('ok')
    expect(result.withinInventory).toBe(false)
    expect(result.track?.shortages.E).toBeGreaterThan(0)
    expect(result.track?.usage.E).toBeGreaterThanOrEqual(8)
  })

  it('does not use pieces the user does not have when it does not have to', () => {
    const drawn = chain(['D', 'D', 'D'])
    const result = fitDrawing(drawn.points, { area: AREA, inventory: createInventory({ A2: 20 }) })

    expect(result.reason).toBe('ok')
    expect(result.withinInventory).toBe(true)
    expect(Object.keys(result.track?.usage ?? {})).toEqual(['A2'])
  })

  it('refuses a stroke that crosses itself', () => {
    // Kahdeksikko: silmukat leikkaavat toisensa, eikä risteystä ratkaista vielä.
    const loop = chain(CIRCLE)
    const second = chain(CIRCLE, { ...loop.end, dir: loop.end.dir })
    const result = fitDrawing([...loop.points, ...second.points], { area: AREA })

    expect(result.track).toBeNull()
    expect(['self-collision', 'closure-beyond-budget', 'no-fit']).toContain(result.reason)
  })

  it('produces a track the result page can summarise', () => {
    const drawn = chain(['D', 'E', 'E', 'D'])
    const track = fitDrawing(drawn.points, { area: AREA, inventory: unlimitedInventory() }).track

    expect(track?.bbox.maxX).toBeGreaterThan(track?.bbox.minX as number)
    expect(track?.maxLevel).toBe(0)
    expect(track?.fitsArea).toBe(true)
    expect(Object.values(track?.usage ?? {}).reduce((sum, count) => sum + count, 0)).toBe(track?.pieces.length)
  })
})

describe('buildTarget', () => {
  it('measures progress along the stroke', () => {
    const drawing = cleanDrawing([{ x: 0, y: 0 }, { x: 1000, y: 0 }]) as NonNullable<ReturnType<typeof cleanDrawing>>
    const target = buildTarget(drawing)

    expect(target.lengthMm).toBeCloseTo(1000, 6)
    expect(target.project({ x: 300, y: 25 }, 0, 1000)).toMatchObject({ distanceMm: 25 })
    expect(target.project({ x: 300, y: 25 }, 0, 1000).alongMm).toBeCloseTo(300, 6)
    expect(target.headingDegAt(0, 80)).toBeCloseTo(0, 6)
  })

  it('never looks past the window, so a stroke that folds back does not jump', () => {
    const drawing = cleanDrawing([
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 40 },
      { x: 0, y: 40 },
    ]) as NonNullable<ReturnType<typeof cleanDrawing>>
    const target = buildTarget(drawing)

    // Piste on lähempänä paluusuoraa, mutta ikkuna pitää etenemän menosuorassa.
    const projection = target.project({ x: 500, y: 35 }, 0, 600)
    expect(projection.alongMm).toBeLessThanOrEqual(600)
  })
})
