import { describe, expect, it } from 'vitest'
import { isDir } from './dir'
import { buildLibrary, defaultLibrary } from './library'
import { pathLength } from './path'
import { placeAtFrame, resolvePiece, startFrame, validatePiece, type PieceSpec } from './pieces'
import { canMate, portSignatures, signaturesMatch, transformPort } from './ports'
import { EPS_MM, MICRO_GRID_MM, isOnMicroGrid } from './units'

const library = defaultLibrary()

describe('piece library', () => {
  it('loads without validation problems', () => {
    expect(library.problems).toEqual([])
  })

  it('ships the straights and curves README chapter 2 pins down', () => {
    const basicStraights = library.straights().filter((p) => !p.tags.includes('bridge-deck'))
    expect(basicStraights.map((p) => p.id)).toEqual(['A2', 'A3', 'A1', 'A', 'D'])
    expect(basicStraights.map((p) => p.straightLengthMm)).toEqual([54, 72, 108, 144, 216])
    expect(library.get('E').lengthMm).toBeCloseTo((202 * Math.PI) / 4, 6)
    expect(library.get('E1').lengthMm).toBeCloseTo((110 * Math.PI) / 4, 6)
  })

  it('keeps every straight exactly on the 18 mm micro grid', () => {
    for (const piece of library.pieces) {
      if (piece.straightLengthMm !== null) {
        expect(isOnMicroGrid(piece.straightLengthMm), `${piece.id}`).toBe(true)
        expect(piece.straightLengthMm % MICRO_GRID_MM).toBe(0)
      }
    }
  })

  it('keeps every port direction on a 45° slot', () => {
    for (const piece of library.pieces) {
      for (const port of piece.ports) {
        expect(isDir(port.dir), `${piece.id}.${port.id}`).toBe(true)
      }
    }
  })

  it('gives every piece exactly two main ports and complementary connectors', () => {
    for (const piece of library.pieces) {
      expect(piece.mainPorts, piece.id).toHaveLength(2)
      expect(piece.mainPorts[0].connector).not.toBe(piece.mainPorts[1].connector)
    }
  })
})

describe('parametric geometry', () => {
  it('places a straight exactly along the grid', () => {
    const d = library.get('D')
    const result = placeAtFrame(d, startFrame(0, 0, 0))
    expect(result).not.toBeNull()
    expect(result?.exit.x).toBeCloseTo(216, 9)
    expect(result?.exit.y).toBeCloseTo(0, 9)
    expect(result?.exit.dir).toBe(0)
  })

  it('turns 90° with two E curves and lands on the 202 x 202 corner', () => {
    const e = library.get('E')
    const first = placeAtFrame(e, startFrame(0, 0, 0))
    expect(first).not.toBeNull()
    const second = placeAtFrame(e, first!.exit)
    expect(second).not.toBeNull()
    // README luku 2: "2xE-kulma vie ~202x202 mm".
    expect(second!.exit.x).toBeCloseTo(202, 6)
    expect(second!.exit.y).toBeCloseTo(202, 6)
    expect(second!.exit.dir).toBe(2)
  })

  it('turns the other way when the curve is mirrored', () => {
    const e = library.get('E')
    const first = placeAtFrame(e, startFrame(0, 0, 0), { mirror: true })
    const second = placeAtFrame(e, first!.exit, { mirror: true })
    expect(second!.exit.x).toBeCloseTo(202, 6)
    expect(second!.exit.y).toBeCloseTo(-202, 6)
    expect(second!.exit.dir).toBe(6)
  })

  it('fits an E1 corner into half a logical cell', () => {
    const e1 = library.get('E1')
    const first = placeAtFrame(e1, startFrame(0, 0, 0))
    const second = placeAtFrame(e1, first!.exit)
    expect(second!.exit.x).toBeCloseTo(110, 6)
    expect(second!.exit.y).toBeCloseTo(110, 6)
  })

  it('raises the cursor one level across the N ramp', () => {
    const n = library.get('N')
    const result = placeAtFrame(n, startFrame(0, 0, 0))
    expect(result?.exit.level).toBe(1)
    expect(result?.exit.x).toBeCloseTo(216, 9)
  })

  it('refuses a bridge deck below its minimum level', () => {
    const deck = library.get('DECK216')
    expect(placeAtFrame(deck, startFrame(0, 0, 0, 0))).toBeNull()
    expect(placeAtFrame(deck, startFrame(0, 0, 0, 1))).not.toBeNull()
  })

  it('refuses to mate two identical connectors', () => {
    const d = library.get('D')
    // Kohdistimen avoin pää on kolo, joten seuraavan palan sisääntulon pitäisi
    // olla tappi — D:n sisääntulo on kolo, joten sijoitus hylätään.
    expect(placeAtFrame(d, startFrame(0, 0, 0, 0, 'socket'))).toBeNull()
    expect(placeAtFrame(d, startFrame(0, 0, 0, 0, 'socket'), { entryPortId: 'out', exitPortId: 'in' })).not.toBeNull()
  })

  it('produces mating ports between consecutive pieces', () => {
    const d = library.get('D')
    const first = placeAtFrame(d, startFrame(0, 0, 0))!
    const second = placeAtFrame(d, first.exit)!
    const exitPort = transformPort(d.ports.find((p) => p.id === first.placed.exitPortId)!, first.placed.placement)
    const entryPort = transformPort(d.ports.find((p) => p.id === second.placed.entryPortId)!, second.placed.placement)
    expect(canMate(exitPort, entryPort)).toBe(true)
  })

  it('derives centreline length from the geometry, not from the data', () => {
    expect(pathLength(library.get('A').segments)).toBeCloseTo(144, 9)
  })

  it('draws curves as real SVG arcs', () => {
    expect(library.get('E').pathData).toMatch(/^M0,0 A202,202 0 0 1 /)
  })
})

describe('substitution classes', () => {
  it('puts equal-length straights in the same class', () => {
    expect(signaturesMatch(library.get('D').signatures, library.get('DECK216').signatures)).toBe(true)
    expect(signaturesMatch(library.get('A').signatures, library.get('DECK144').signatures)).toBe(true)
  })

  it('puts the N ramp in the 216 mm class (README chapter 2)', () => {
    expect(library.substitutesFor('D').map((p) => p.id)).toContain('N')
  })

  it('keeps different lengths apart', () => {
    expect(signaturesMatch(library.get('A').signatures, library.get('D').signatures)).toBe(false)
    expect(signaturesMatch(library.get('E').signatures, library.get('E1').signatures)).toBe(false)
  })

  it('is invariant under the pose a piece happens to be authored in', () => {
    const authored = resolvePiece({ id: 'X', kind: 'straight', lengthMm: 144 }, new Map())
    const rotated = resolvePiece(
      {
        id: 'Y',
        kind: 'custom',
        ports: [
          { id: 'in', x: 100, y: 100, dir: 6, connector: 'socket' },
          { id: 'out', x: 100, y: 244, dir: 2, connector: 'pin' },
        ],
        lengthMm: 144,
      },
      new Map(),
    )
    expect(signaturesMatch(authored.signatures, rotated.signatures)).toBe(true)
  })

  it('ignores branch ports so a branching piece joins its through-route class', () => {
    const branching = resolvePiece(
      {
        id: 'BRANCHY',
        kind: 'custom',
        ports: [
          { id: 'in', x: 0, y: 0, dir: 4, connector: 'socket' },
          { id: 'out', x: 216, y: 0, dir: 0, connector: 'pin' },
          { id: 'branch', x: 108, y: 108, dir: 2, connector: 'pin', branch: true },
        ],
        lengthMm: 216,
      },
      new Map(),
    )
    expect(signaturesMatch(branching.signatures, library.get('D').signatures)).toBe(true)
    expect(portSignatures(branching.ports, false)).not.toEqual(branching.signatures)
  })
})

describe('composite pieces (library level 2)', () => {
  const specs: PieceSpec[] = [
    { id: 'A', kind: 'straight', lengthMm: 144 },
    { id: 'E', kind: 'curve', radiusMm: 202, sweepDeg: 45, hand: 'right' },
    {
      id: 'AE',
      kind: 'composite',
      parts: [
        { piece: 'A', rename: { in: 'in', out: 'mid' } },
        { piece: 'E', join: { toPort: 'mid' }, rename: { out: 'out' } },
      ],
    },
  ]

  it('chains parts and exposes only the open ports', () => {
    const composite = buildLibrary(specs)
    expect(composite.problems).toEqual([])
    const ae = composite.get('AE')
    expect(ae.ports.map((p) => p.id).sort()).toEqual(['in', 'out'])
    expect(ae.lengthMm).toBeCloseTo(144 + (202 * Math.PI) / 4, 6)
    const out = ae.ports.find((p) => p.id === 'out')!
    expect(out.x).toBeCloseTo(144 + 202 * Math.sin(Math.PI / 4), 6)
    expect(out.dir).toBe(1)
  })

  it('reports a composite whose parts cannot be resolved', () => {
    const broken = buildLibrary([{ id: 'Z', kind: 'composite', parts: [{ piece: 'NOPE' }] }])
    expect(broken.problems.map((p) => p.code)).toContain('unresolved-parts')
  })
})

describe('validation', () => {
  it('flags a straight that misses the micro grid', () => {
    const piece = resolvePiece({ id: 'ODD', kind: 'straight', lengthMm: 100 }, new Map())
    expect(validatePiece(piece).map((p) => p.code)).toContain('off-grid')
  })

  it('rejects a port direction that is not a 45° slot', () => {
    expect(() =>
      resolvePiece(
        { id: 'BAD', kind: 'custom', ports: [{ id: 'in', x: 0, y: 0, dir: 1.5, connector: 'socket' }] },
        new Map(),
      ),
    ).toThrow(/45/)
  })

  it('rejects a curve whose sweep misses the 45° slots', () => {
    expect(() => resolvePiece({ id: 'BAD', kind: 'curve', radiusMm: 200, sweepDeg: 30, hand: 'right' }, new Map())).toThrow()
  })

  it('flags a piece without a two-port main span', () => {
    const piece = resolvePiece(
      { id: 'STUB', kind: 'custom', ports: [{ id: 'in', x: 0, y: 0, dir: 4, connector: 'socket' }] },
      new Map(),
    )
    expect(validatePiece(piece).map((p) => p.code)).toEqual(expect.arrayContaining(['too-few-ports', 'main-span']))
  })
})

describe('epsilon', () => {
  it('is tight enough to distinguish a micro grid step', () => {
    expect(EPS_MM).toBeLessThan(MICRO_GRID_MM / 2)
  })
})
