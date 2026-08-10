import { describe, expect, it } from 'vitest'
import {
  AREA_MAX_MM,
  AREA_MIN_MM,
  DEFAULT_SETTINGS,
  INVENTORY_PRESETS,
  QUICK_SIZES,
  normalizeArea,
  normalizeSettings,
  toFlexSettings,
  toInventory,
  type AppSettings,
} from './settings'
import { Ledger, createInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { buildElementLibrary, bundledElementSpecs } from '../gen/elements'
import { buildShareUrl, deserializeSettings, readSharedSettings, serializeSettings, toBase64Url } from './share'
import { ownablePieces, pieceGroups, sortForPartsList } from './pieceGroups'

const library = defaultLibrary()

describe('settings', () => {
  it('clamps the area to a size the generator can work with', () => {
    expect(normalizeArea({ kind: 'rect', widthMm: 10, depthMm: 99999 })).toEqual({
      kind: 'rect',
      widthMm: AREA_MIN_MM,
      depthMm: AREA_MAX_MM,
    })
  })

  it('snaps the area to the 10 cm step the steppers use', () => {
    expect(normalizeArea({ kind: 'rect', widthMm: 2037, depthMm: 1462 })).toEqual({
      kind: 'rect',
      widthMm: 2000,
      depthMm: 1500,
    })
  })

  it('keeps an L-shaped cut from eating the whole area', () => {
    const area = normalizeArea({
      kind: 'L',
      widthMm: 2400,
      depthMm: 1800,
      cutWidthMm: 9000,
      cutDepthMm: 9000,
      corner: 'ne',
    })
    expect(area.kind).toBe('L')
    if (area.kind !== 'L') return
    expect(area.cutWidthMm).toBeLessThan(area.widthMm)
    expect(area.cutDepthMm).toBeLessThan(area.depthMm)
  })

  it('drops zero counts and rejects nonsense', () => {
    const settings = normalizeSettings({ inventoryCounts: { A: 0, D: 4, E: -3, X: Number.NaN } })
    expect(settings.inventoryCounts).toEqual({ D: 4 })
  })

  it('fills in defaults for an empty object', () => {
    expect(normalizeSettings({})).toMatchObject({ area: DEFAULT_SETTINGS.area, seed: '' })
  })

  it('turns skip mode into an unlimited inventory', () => {
    expect(toInventory({ ...DEFAULT_SETTINGS, skipInventory: true }).unlimited).toBe(true)
    const owned = toInventory({ ...DEFAULT_SETTINGS, skipInventory: false, inventoryCounts: { D: 3 } })
    expect(owned.unlimited).toBe(false)
    expect(owned.counts).toEqual({ D: 3 })
  })

  it('disables the flex piece in shopping list mode (README chapter 2)', () => {
    const base: AppSettings = { ...DEFAULT_SETTINGS, flex: { enabled: true, count: 3 } }
    expect(toFlexSettings({ ...base, skipInventory: true }).count).toBe(0)
    expect(toFlexSettings({ ...base, skipInventory: false }).count).toBe(3)
  })

  it('offers quick sizes and presets that survive normalisation unchanged', () => {
    for (const size of QUICK_SIZES) {
      expect(normalizeArea(size.area), size.key).toEqual(size.area)
    }
    for (const preset of INVENTORY_PRESETS) {
      for (const id of Object.keys(preset.counts)) {
        expect(library.has(id), `${preset.key} references ${id}`).toBe(true)
      }
    }
  })

  it('can build a hill out of every preset that stocks the ramps for one', () => {
    // Laskeva ramppi kuljetaan yläpäästä sisään, joten mäki tarvitsee myös
    // sukupuolenvaihtajat. Kokoelma, jossa on rampit ja kansi muttei niitä,
    // sisältäisi mäen palat muttei osaisi rakentaa mäkeä.
    for (const preset of INVENTORY_PRESETS) {
      const stocksRamps = (preset.counts.N ?? 0) >= 2
      if (!stocksRamps) continue
      const elements = buildElementLibrary(bundledElementSpecs(), library, new Ledger(createInventory(preset.counts)))
      expect(elements.byRole('hill').length, `${preset.key} builds a hill`).toBeGreaterThan(0)
    }
  })
})

describe('piece groups', () => {
  it('never offers a piece whose geometry is unverified', () => {
    expect(ownablePieces(library).some((piece) => piece.tags.includes('unverified-geometry'))).toBe(false)
  })

  it('puts every basic piece in exactly one group', () => {
    const groups = pieceGroups(library, true)
    const ids = groups.flatMap((group) => group.pieces.map((piece) => piece.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['A', 'D', 'E', 'E1', 'N']))
  })

  it('shows more pieces when the full list is requested', () => {
    const basic = pieceGroups(library, true).flatMap((group) => group.pieces)
    const all = pieceGroups(library, false).flatMap((group) => group.pieces)
    expect(all.length).toBeGreaterThan(basic.length)
  })

  it('orders a parts list by group and then by length', () => {
    expect(sortForPartsList(library, ['E', 'D', 'A2', 'A'])).toEqual(['A2', 'A', 'D', 'E'])
  })
})

describe('share links', () => {
  const settings: AppSettings = {
    area: { kind: 'L', widthMm: 2400, depthMm: 1800, cutWidthMm: 800, cutDepthMm: 700, corner: 'se' },
    inventoryCounts: { E: 8, D: 4 },
    skipInventory: false,
    flex: { enabled: true, count: 2 },
    seed: 'kaisan rata',
  }

  it('round-trips every setting', () => {
    expect(deserializeSettings(serializeSettings(settings))).toEqual(settings)
  })

  it('round-trips skip mode', () => {
    const skip = { ...settings, skipInventory: true, inventoryCounts: {} }
    expect(deserializeSettings(serializeSettings(skip))).toEqual(skip)
  })

  it('survives a seed containing the field separator', () => {
    const odd = { ...settings, seed: 'a~b~c' }
    expect(deserializeSettings(serializeSettings(odd))?.seed).toBe('a~b~c')
  })

  it('survives non-ascii text in the seed', () => {
    const odd = { ...settings, seed: 'Kaisan rata 🚂 äöå' }
    const url = buildShareUrl(odd, 'https://example.test/')
    expect(readSharedSettings(new URL(url.url).search)?.seed).toBe('Kaisan rata 🚂 äöå')
  })

  it('rejects a corrupt or foreign parameter instead of guessing', () => {
    expect(deserializeSettings('not-a-share-string')).toBeNull()
    expect(deserializeSettings(`2~R,2000,1500~*~0~x`)).toBeNull()
    expect(readSharedSettings('?r=%%%')).toBeNull()
    expect(readSharedSettings('?other=1')).toBeNull()
  })

  it('builds a link well inside the URL length limit (R6)', () => {
    const link = buildShareUrl(settings, 'https://example.test/')
    expect(link.tooLong).toBe(false)
    expect(link.url.length).toBeLessThan(400)
    expect(readSharedSettings(new URL(link.url).search)).toEqual(settings)
  })

  it('reports honestly when a link would be too long instead of truncating it', () => {
    const huge: AppSettings = { ...settings, seed: 'x'.repeat(4000) }
    const link = buildShareUrl(huge, 'https://example.test/')
    expect(link.tooLong).toBe(true)
  })

  it('encodes to a URL-safe alphabet', () => {
    expect(toBase64Url('~~~???>>>')).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
