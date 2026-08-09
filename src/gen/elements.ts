import basic from '../../data/elements/basic.json'
import { angleDifferenceDeg, dirToDegrees } from '../core/dir'
import type { Ledger } from '../core/inventory'
import type { PieceLibrary } from '../core/library'
import { polygonBBox, unionBBox, type BBox } from '../core/path'
import { placeAtFrame, placeTerminal, placedBBox, startFrame, type Frame, type PlacedPiece } from '../core/pieces'
import { portSignatures, transformPort } from '../core/ports'

// Elementti = makropala (README luku 3). Elementtikirjasto on dataa kuten
// palakirjastokin: uusi elementti on rivi `data/elements/`-tiedostoon.
//
// Kaksi elementtiä ovat vaihtokelpoisia, jos porttisignatuuri on sama. Signatuuri
// lasketaan elementin päätyporteista, joten se on suoraan verrattavissa palojen
// signatuureihin.

export type ElementRole = 'through' | 'turn' | 'uturn' | 'hill' | 'siding' | 'branch' | 'crossing'

export interface ElementStep {
  piece: string
  /** Peilaa yksittäisen palan (kaari toiseen suuntaan). */
  mirror?: boolean
  /** Kuljetaan pala väärinpäin — laskeva ramppi mennään yläpäästä sisään. */
  reverse?: boolean
  /** Sivuhaara: palat, jotka asennetaan tämän palan haaraporttiin. */
  branch?: { portId: string; steps: ElementStep[] }
}

export interface ElementSpec {
  id: string
  role: ElementRole
  steps: ElementStep[]
  /** "flexible" sallii liittimen sukupuolen kääntämisen (asetus "salli kääntö/adapterit"). */
  connectorPolicy?: 'strict' | 'flexible'
  tags?: string[]
  notes?: string
}

export interface ResolvedElement {
  spec: ElementSpec
  id: string
  role: ElementRole
  /** Siirtymä sisääntulon suuntaan. */
  alongMm: number
  /** Siirtymä sisääntuloon nähden oikealle. */
  acrossMm: number
  /** Suunnanmuutos asteina, oikealle positiivinen. */
  turnDeg: number
  /** Elementin viemä pituus sisääntulon suunnassa + poikittain (kulman "tangenttimitta"). */
  lengthMm: number
  levelDelta: number
  pieceCounts: Record<string, number>
  signatures: string[]
  bbox: BBox
  tags: string[]
}

export interface ElementLibrary {
  elements: ResolvedElement[]
  byId: ReadonlyMap<string, ResolvedElement>
  byRole(role: ElementRole): ResolvedElement[]
  get(id: string): ResolvedElement
  /** Elementit, joiden signatuuri vastaa annettua (vaihtokelpoiset toteutukset). */
  forSignature(signatures: readonly string[]): ResolvedElement[]
}

export interface Traversal {
  placed: PlacedPiece[]
  exit: Frame
  /**
   * Liitokset paloparien välillä `placed`-taulukon indekseinä. Sivuhaaran
   * jälkeen taulukkojärjestys ei enää vastaa ketjun järjestystä, joten
   * naapuruus on kirjattava erikseen — törmäystarkistus tarvitsee sen.
   */
  edges: [number, number][]
  /** Pääketjun viimeinen pala; sivuhaarat eivät jatka ketjua. */
  lastIndex: number
}

/**
 * Kulkee elementin läpi annetusta kohdistimesta ja varaa palat kirjanpidosta.
 * Palauttaa null ja vapauttaa varaukset, jos jokin askel ei onnistu — epäonnistunut
 * yritys ei jätä rikkinäistä tilaa (CLAUDE.md).
 */
export function traverseElement(
  spec: ElementSpec,
  library: PieceLibrary,
  ledger: Ledger,
  frame: Frame,
  mirror: boolean,
): Traversal | null {
  const placed: PlacedPiece[] = []
  const taken: string[] = []
  const edges: [number, number][] = []

  const result = traverseSteps(spec, spec.steps, library, ledger, frame, mirror, placed, taken, edges, -1)
  if (!result) {
    for (const id of taken) ledger.release(id)
    return null
  }
  return { placed, exit: result.exit, edges, lastIndex: result.lastIndex }
}

/**
 * Kulkee askelketjun läpi. Umpipää (puskuri) päättää ketjun, joten sen jälkeen
 * ei synny uutta kohdistinta — sivuhaarat päättyvät aina umpipäähän.
 */
function traverseSteps(
  spec: ElementSpec,
  steps: readonly ElementStep[],
  library: PieceLibrary,
  ledger: Ledger,
  frame: Frame,
  mirror: boolean,
  placed: PlacedPiece[],
  taken: string[],
  edges: [number, number][],
  attachedTo: number,
): { exit: Frame; lastIndex: number } | null {
  let cursor = frame
  let previous = attachedTo

  for (const [stepIndex, step] of steps.entries()) {
    if (!library.has(step.piece)) return null
    const piece = library.get(step.piece)
    // Peilaus koskee koko elementtiä; yksittäisen askeleen lippu kääntää sen.
    const stepMirror = mirror !== (step.mirror ?? false)
    const allowConnectorFlip = spec.connectorPolicy === 'flexible'

    if (piece.isTerminal) {
      if (stepIndex !== steps.length - 1) return null
      const terminal = placeTerminal(piece, cursor, { mirror: stepMirror, allowConnectorFlip })
      if (!terminal || !ledger.take(piece.id)) return null
      taken.push(piece.id)
      const index = placed.push(terminal) - 1
      if (previous >= 0) edges.push([previous, index])
      return { exit: cursor, lastIndex: index }
    }

    const [first, second] = piece.mainPorts
    if (!first || !second) return null
    const result = placeAtFrame(piece, cursor, {
      mirror: stepMirror,
      entryPortId: step.reverse ? second.id : first.id,
      exitPortId: step.reverse ? first.id : second.id,
      allowConnectorFlip,
    })
    if (!result || !ledger.take(piece.id)) return null
    taken.push(piece.id)
    const index = placed.push(result.placed) - 1
    if (previous >= 0) edges.push([previous, index])

    if (step.branch) {
      const port = piece.ports.find((candidate) => candidate.id === step.branch?.portId)
      if (!port) return null
      const world = transformPort(port, result.placed.placement)
      const branchFrame: Frame = { x: world.x, y: world.y, dir: world.dir, level: world.levelOffset, open: world.connector }
      // Sivuhaara riippuu tästä palasta muttei jatka pääketjua.
      if (!traverseSteps(spec, step.branch.steps, library, ledger, branchFrame, stepMirror, placed, taken, edges, index)) {
        return null
      }
    }

    previous = index
    cursor = result.exit
  }

  return { exit: cursor, lastIndex: previous }
}

/** Laskee elementin geometrian sijoittamalla sen kerran kanoniseen kohdistimeen. */
export function resolveElement(spec: ElementSpec, library: PieceLibrary, ledger: Ledger): ResolvedElement | null {
  const start = startFrame(0, 0, 0, 0, 'pin')
  const traversal = traverseElement(spec, library, ledger, start, false)
  if (!traversal) return null

  const pieceCounts: Record<string, number> = {}
  let lengthMm = 0
  for (const placed of traversal.placed) {
    pieceCounts[placed.pieceId] = (pieceCounts[placed.pieceId] ?? 0) + 1
    lengthMm += library.get(placed.pieceId).lengthMm
  }

  const exitPortDir = traversal.exit.dir
  const signatures = portSignatures(
    [
      { id: 'in', x: 0, y: 0, dir: 4, connector: 'socket', levelOffset: 0, branch: false },
      { id: 'out', x: traversal.exit.x, y: traversal.exit.y, dir: exitPortDir, connector: 'pin', levelOffset: traversal.exit.level, branch: false },
    ],
    true,
  )

  return {
    spec,
    id: spec.id,
    role: spec.role,
    alongMm: traversal.exit.x,
    acrossMm: traversal.exit.y,
    turnDeg: angleDifferenceDeg(dirToDegrees(traversal.exit.dir), dirToDegrees(start.dir)),
    lengthMm,
    levelDelta: traversal.exit.level - start.level,
    pieceCounts,
    signatures,
    bbox: unionBBox(
      traversal.placed.map((placed) => placedBBox(placed, library.get(placed.pieceId))),
    ),
    tags: spec.tags ?? [],
  }
}

export function buildElementLibrary(specs: readonly ElementSpec[], library: PieceLibrary, ledger: Ledger): ElementLibrary {
  const byId = new Map<string, ResolvedElement>()
  for (const spec of specs) {
    // Resolvointi tehdään rajattomalla kirjanpidolla: geometria ei riipu inventaariosta.
    const resolved = resolveElement(spec, library, ledger.clone())
    if (resolved) byId.set(resolved.id, resolved)
  }
  const elements = [...byId.values()]
  return {
    elements,
    byId,
    byRole: (role) => elements.filter((element) => element.role === role),
    get(id) {
      const element = byId.get(id)
      if (!element) throw new ReferenceError(`unknown element "${id}"`)
      return element
    },
    forSignature: (signatures) => elements.filter((element) => element.signatures.some((key) => signatures.includes(key))),
  }
}

export function bundledElementSpecs(): ElementSpec[] {
  return basic as ElementSpec[]
}

export { polygonBBox }
