import { describe, expect, it } from 'vitest'
import { buildFillTable, inventoryFillTable } from '../core/fill'
import { createInventory, unlimitedInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { entryFrame, exitFrame, startFrame } from '../core/pieces'
import { MICRO_GRID_MM } from '../core/units'
import { bundledVariationSpecs, resolveVariation, type VariationSpec } from './variations'

const library = defaultLibrary()
const table = buildFillTable(library.fillerStraights().map((piece) => piece.straightLengthMm as number))
const specs = bundledVariationSpecs()

/** Osuus, jolle kuvio mahtuu varmasti: viisi solua suoraa. */
const LONG_RUN_MM = 216 * 5

function resolveAll(maxAlongMm = LONG_RUN_MM) {
  return specs.map((spec) => ({ spec, resolved: resolveVariation(spec, library, table, unlimitedInventory(), maxAlongMm) }))
}

describe('variation library', () => {
  it('covers every pattern README chapter 6 lists', () => {
    expect(new Set(specs.map((spec) => spec.kind))).toEqual(
      new Set(['siding', 'passing-loop', 's-bend', 'bulge', 'hill', 'skew', 'junction']),
    )
  })

  it('has a unique id per pattern', () => {
    expect(new Set(specs.map((spec) => spec.id)).size).toBe(specs.length)
  })

  it('resolves every bundled pattern into real pieces', () => {
    for (const { spec, resolved } of resolveAll()) {
      expect(resolved, `${spec.id} did not resolve`).not.toBeNull()
      expect(resolved?.pieceCount).toBeGreaterThan(0)
    }
  })

  it('only uses pieces the library actually has', () => {
    for (const { spec, resolved } of resolveAll()) {
      for (const id of Object.keys(resolved?.pieceCounts ?? {})) {
        expect(library.has(id), `${spec.id} uses unknown piece ${id}`).toBe(true)
      }
    }
  })
})

describe('resolveVariation', () => {
  it('leaves the cursor on the same line: same direction, level and connector', () => {
    const start = startFrame(0, 0, 0, 0, 'pin')
    for (const { spec, resolved } of resolveAll()) {
      const run = resolved?.run(start)
      expect(run, `${spec.id}`).not.toBeNull()
      if (!run) continue
      expect(run.exit.dir, `${spec.id} direction`).toBe(start.dir)
      expect(run.exit.level, `${spec.id} level`).toBe(start.level)
      expect(run.exit.open, `${spec.id} connector`).toBe(start.open)
      // Sivusiirtymä on se, mikä tekee kuviosta ytimen: ilman sitä osuuden
      // loppuportti liikkuisi eikä muu rata pysyisi paikallaan.
      expect(Math.abs(run.exit.y), `${spec.id} lateral offset`).toBeLessThan(1)
    }
  })

  it('places the core the same way from anywhere on the track', () => {
    for (const { spec, resolved } of resolveAll()) {
      const home = resolved?.run(startFrame(0, 0, 0, 0, 'pin'))
      const away = resolved?.run(startFrame(1000, 500, 2, 0, 'pin'))
      expect(away, `${spec.id}`).not.toBeNull()
      if (!home || !away) continue
      expect(away.placed.map((placed) => placed.pieceId)).toEqual(home.placed.map((placed) => placed.pieceId))
      expect(away.edges).toEqual(home.edges)
      // Neljänneskierros ja siirto: etenemä säilyy, vain suunta vaihtuu.
      expect(Math.hypot(away.exit.x - 1000, away.exit.y - 500)).toBeCloseTo(home.exit.x, 6)
    }
  })

  it('reports the side clearance each pattern needs', () => {
    const byId = new Map(resolveAll().map(({ spec, resolved }) => [spec.id, resolved]))

    // Mäki menee ylös eikä sivuun; pullistuma tarvitsee tilaa vain toiselta
    // puolelta ja S-kiemura molemmilta (README luku 6).
    expect(byId.get('hill')?.leftMm).toBe(0)
    expect(byId.get('hill')?.rightMm).toBe(0)
    expect(byId.get('bulge-right')?.leftMm).toBe(0)
    expect(byId.get('bulge-right')?.rightMm).toBeGreaterThan(100)
    expect(byId.get('bulge-left')?.leftMm).toBeGreaterThan(100)
    expect(byId.get('bulge-left')?.rightMm).toBe(0)
    expect(byId.get('s-bend')?.leftMm).toBeGreaterThan(50)
    expect(byId.get('s-bend')?.rightMm).toBeGreaterThan(50)
  })

  it('keeps the straight-only patterns exactly on the micro grid', () => {
    // Mäki on pelkkiä suoria ja ramppeja, joten se täyttää osuuden eksaktisti.
    const hill = resolveVariation(specs.find((spec) => spec.id === 'hill') as VariationSpec, library, table, unlimitedInventory(), LONG_RUN_MM)
    expect((hill?.alongMm ?? 0) % MICRO_GRID_MM).toBeCloseTo(0, 6)
  })

  it('lets the curve patterns fall off the grid: that is what Vario is for', () => {
    const bulge = resolveVariation(specs.find((spec) => spec.id === 'bulge-right') as VariationSpec, library, table, unlimitedInventory(), LONG_RUN_MM)
    expect((bulge?.alongMm ?? 0) % MICRO_GRID_MM).toBeGreaterThan(0.5)
  })

  it('closes the passing loop within the Vario budget', () => {
    for (const id of ['passing-loop-right', 'passing-loop-left']) {
      const spec = specs.find((candidate) => candidate.id === id) as VariationSpec
      const resolved = resolveVariation(spec, library, table, unlimitedInventory(), LONG_RUN_MM)
      expect(resolved, id).not.toBeNull()
      // Silmukka ei sulkeudu eksaktisti, mutta jäännöksen on oltava sitä
      // luokkaa, jonka liitokset nielevät — ei senttejä.
      expect(resolved?.linkGapMm).toBeGreaterThan(0)
      expect(resolved?.linkGapMm).toBeLessThan(6)
    }
  })

  it('joins the passing loop back to the second switch', () => {
    const spec = specs.find((candidate) => candidate.id === 'passing-loop-right') as VariationSpec
    const run = resolveVariation(spec, library, table, unlimitedInventory(), LONG_RUN_MM)?.run(startFrame(0, 0, 0, 0, 'pin'))
    if (!run) throw new Error('no run')

    // Umpisilmukka: sivuraiteen molemmat päät ovat kiinni, joten liitoksia on
    // yhtä monta kuin paloja — peräkkäisessä ketjussa yksi vähemmän.
    expect(run.edges.length).toBe(run.placed.length)
    expect(run.placed.map((placed) => placed.pieceId)).toContain('J')
  })

  it('gives up on a section that is too short for the pattern', () => {
    const hill = specs.find((spec) => spec.id === 'hill') as VariationSpec
    expect(resolveVariation(hill, library, table, unlimitedInventory(), 432)).toBeNull()
  })

  it('gives up when the collection has no pieces for the pattern', () => {
    const inventory = createInventory({ D: 20, E: 8 })
    const siding = specs.find((spec) => spec.id === 'siding-right') as VariationSpec
    const limited = inventoryFillTable(library, inventory)
    expect(resolveVariation(siding, library, limited, inventory, LONG_RUN_MM)).toBeNull()
  })

  it('is deterministic: the same section gives the same pieces every time', () => {
    for (const spec of specs) {
      const first = resolveVariation(spec, library, table, unlimitedInventory(), LONG_RUN_MM)
      const second = resolveVariation(spec, library, table, unlimitedInventory(), LONG_RUN_MM)
      expect(second?.pieceCounts, spec.id).toEqual(first?.pieceCounts)
      expect(second?.alongMm, spec.id).toBe(first?.alongMm)
    }
  })

  it('hangs the siding buffer off the switch, not off the end of the run', () => {
    const spec = specs.find((candidate) => candidate.id === 'siding-right') as VariationSpec
    const run = resolveVariation(spec, library, table, unlimitedInventory(), LONG_RUN_MM)?.run(startFrame(0, 0, 0, 0, 'pin'))
    if (!run) throw new Error('no run')

    // Pääketju päättyy vaihteeseen, ei puskuriin: ketju jatkuu vaihteen läpi.
    const exit = run.placed[run.exitIndex]
    expect(library.get(exit.pieceId).tags).toContain('switch')
    expect(library.get(run.placed[run.placed.length - 1].pieceId).isTerminal).toBe(true)
    // ...ja puskuri roikkuu vaihteen haarassa, jolloin kohdistin on vaihteen
    // ulostulossa eikä umpipäässä.
    expect(exitFrame(exit, library.get(exit.pieceId)).x).toBeCloseTo(run.exit.x, 6)
    expect(entryFrame(run.placed[0], library.get(run.placed[0].pieceId)).x).toBeCloseTo(0, 6)
  })
})
