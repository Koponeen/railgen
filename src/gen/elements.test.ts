import { describe, expect, it } from 'vitest'
import { Ledger, createInventory, unlimitedInventory } from '../core/inventory'
import { defaultLibrary } from '../core/library'
import { startFrame } from '../core/pieces'
import { signaturesMatch } from '../core/ports'
import { buildElementLibrary, bundledElementSpecs, traverseElement } from './elements'

const library = defaultLibrary()
const elements = buildElementLibrary(bundledElementSpecs(), library, new Ledger(unlimitedInventory()))

describe('element library', () => {
  it('resolves every bundled element', () => {
    expect(elements.elements).toHaveLength(bundledElementSpecs().length)
  })

  it('covers the signatures README chapter 3 lists', () => {
    expect(elements.byRole('through').length).toBeGreaterThan(0)
    expect(elements.byRole('turn').length).toBeGreaterThan(0)
    expect(elements.byRole('uturn').length).toBeGreaterThan(0)
  })

  it('measures a pass-through as exactly one logical cell', () => {
    for (const element of elements.byRole('through')) {
      expect(element.acrossMm, element.id).toBeCloseTo(0, 6)
      expect(element.turnDeg, element.id).toBe(0)
      expect(element.alongMm % 216, element.id).toBeCloseTo(0, 6)
    }
  })

  it('makes every corner a symmetric 90° turn', () => {
    for (const element of elements.byRole('turn')) {
      expect(element.turnDeg, element.id).toBe(90)
      expect(element.alongMm, element.id).toBeCloseTo(element.acrossMm, 6)
    }
  })

  it('measures the 2 x E corner as 202 x 202 mm', () => {
    const corner = elements.get('corner-e')
    expect(corner.alongMm).toBeCloseTo(202, 6)
    expect(corner.acrossMm).toBeCloseTo(202, 6)
    expect(corner.pieceCounts).toEqual({ E: 2 })
  })

  it('stretches the corner when a straight sits between the curves', () => {
    // README luku 2: "venytettävät kulmat" E-A2-E, E-A1-E.
    expect(elements.get('corner-e-a2-e').alongMm).toBeGreaterThan(elements.get('corner-e').alongMm)
    expect(elements.get('corner-e-a1-e').alongMm).toBeGreaterThan(elements.get('corner-e-a2-e').alongMm)
  })

  it('turns a U-turn through 180° without sideways drift along the entry axis', () => {
    const uturn = elements.get('uturn-e')
    expect(uturn.turnDeg).toBe(180)
    expect(uturn.alongMm).toBeCloseTo(0, 6)
    expect(uturn.acrossMm).toBeCloseTo(404, 6)
  })

  it('returns a hill to floor level after climbing', () => {
    const hill = elements.get('hill-d')
    expect(hill.levelDelta).toBe(0)
    expect(hill.alongMm).toBeCloseTo(648, 6)
    expect(hill.acrossMm).toBeCloseTo(0, 6)
    expect(hill.pieceCounts).toEqual({ N: 2, DECK216: 1 })
  })

  it('gives interchangeable through elements the same signature', () => {
    expect(signaturesMatch(elements.get('through-d').signatures, elements.get('through-2a1').signatures)).toBe(true)
    expect(signaturesMatch(elements.get('through-d').signatures, elements.get('through-3a').signatures)).toBe(false)
    expect(elements.forSignature(elements.get('corner-e').signatures).map((e) => e.id)).toContain('corner-e')
  })

  it('matches a through element against the piece that implements it', () => {
    expect(signaturesMatch(elements.get('through-d').signatures, library.get('D').signatures)).toBe(true)
  })
})

describe('element traversal', () => {
  it('mirrors a corner into a left turn', () => {
    const ledger = new Ledger(unlimitedInventory())
    const right = traverseElement(elements.get('corner-e').spec, library, ledger, startFrame(0, 0, 0), false)
    const left = traverseElement(elements.get('corner-e').spec, library, ledger, startFrame(0, 0, 0), true)
    expect(right!.exit.dir).toBe(2)
    expect(left!.exit.dir).toBe(6)
    expect(left!.exit.y).toBeCloseTo(-right!.exit.y, 6)
  })

  it('releases every reservation when a step fails', () => {
    const ledger = new Ledger(createInventory({ E: 1 }))
    expect(traverseElement(elements.get('corner-e').spec, library, ledger, startFrame(0, 0, 0), false)).toBeNull()
    expect(ledger.available('E')).toBe(1)
    expect(ledger.totalUsed()).toBe(0)
  })

  it('needs the connector-flip setting for the descending ramp', () => {
    const ledger = new Ledger(unlimitedInventory())
    const strict = { ...elements.get('hill-d').spec, connectorPolicy: 'strict' as const }
    expect(traverseElement(strict, library, ledger, startFrame(0, 0, 0), false)).toBeNull()
    expect(traverseElement(elements.get('hill-d').spec, library, ledger, startFrame(0, 0, 0), false)).not.toBeNull()
  })

  it('skips an element that names a piece the library does not have', () => {
    const partial = buildElementLibrary(
      [{ id: 'ghost', role: 'turn', steps: [{ piece: 'NOPE' }] }],
      library,
      new Ledger(unlimitedInventory()),
    )
    expect(partial.elements).toHaveLength(0)
  })

  it('has no branch or crossing implementations until those pieces exist', () => {
    // docs/PIECE_LIBRARY.md: vaihteiden ja risteysten mitat ovat vielä tarkistamatta.
    expect(elements.byRole('branch')).toHaveLength(0)
    expect(elements.byRole('crossing')).toHaveLength(0)
  })
})
