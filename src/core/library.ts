import straights from '../../data/pieces/straights.json'
import curves from '../../data/pieces/curves.json'
import elevation from '../../data/pieces/elevation.json'
import { resolvePiece, validatePiece, type PieceProblem, type PieceSpec, type ResolvedPiece } from './pieces'
import { signaturesMatch } from './ports'

/**
 * Palakirjasto kootaan `data/pieces/`-JSONeista. Uusi pala = uusi rivi dataan;
 * korvausluokkiin liittyminen tapahtuu porttisignatuurin kautta automaattisesti
 * (README luku 8), joten tähän tiedostoon ei tarvitse koskea.
 */
export interface PieceLibrary {
  pieces: ResolvedPiece[]
  byId: ReadonlyMap<string, ResolvedPiece>
  problems: PieceProblem[]
  get(id: string): ResolvedPiece
  has(id: string): boolean
  /** Palat, jotka voivat korvata annetun palan (sama porttisignatuuri). */
  substitutesFor(id: string): ResolvedPiece[]
  /** Suorat palat pituusjärjestyksessä — segmentintäytön raaka-aine. */
  straights(): ResolvedPiece[]
  byTag(tag: string): ResolvedPiece[]
}

export function buildLibrary(specs: readonly PieceSpec[]): PieceLibrary {
  const byId = new Map<string, ResolvedPiece>()
  const problems: PieceProblem[] = []

  // Yhdistelmäpalat viittaavat muihin paloihin, joten resolvointi tehdään
  // useammalla kierroksella kunnes edistystä ei enää tapahdu.
  let pending = [...specs]
  while (pending.length > 0) {
    const deferred: PieceSpec[] = []
    let progressed = false
    for (const spec of pending) {
      if (byId.has(spec.id)) {
        problems.push({ pieceId: spec.id, code: 'duplicate-id', detail: 'defined more than once' })
        continue
      }
      try {
        const resolved = resolvePiece(spec, byId)
        byId.set(spec.id, resolved)
        problems.push(...validatePiece(resolved))
        progressed = true
      } catch (error) {
        if (spec.kind === 'composite' && error instanceof ReferenceError) {
          deferred.push(spec)
          continue
        }
        problems.push({ pieceId: spec.id, code: 'resolve-failed', detail: String(error instanceof Error ? error.message : error) })
      }
    }
    if (!progressed) {
      for (const spec of deferred) {
        problems.push({ pieceId: spec.id, code: 'unresolved-parts', detail: 'composite parts could not be resolved' })
      }
      break
    }
    pending = deferred
  }

  const pieces = [...byId.values()]

  return {
    pieces,
    byId,
    problems,
    get(id) {
      const piece = byId.get(id)
      if (!piece) throw new ReferenceError(`unknown piece "${id}"`)
      return piece
    },
    has: (id) => byId.has(id),
    substitutesFor(id) {
      const piece = this.get(id)
      return pieces.filter((other) => other.id !== id && signaturesMatch(other.signatures, piece.signatures))
    },
    straights() {
      return pieces
        .filter((piece) => piece.kind === 'straight' && piece.straightLengthMm !== null)
        .sort((a, b) => (a.straightLengthMm as number) - (b.straightLengthMm as number))
    },
    byTag: (tag) => pieces.filter((piece) => piece.tags.includes(tag)),
  }
}

const BUNDLED_SPECS = [...straights, ...curves, ...elevation] as unknown as PieceSpec[]

let cached: PieceLibrary | null = null

/** Repossa mukana tuleva BRIO-peruspalasto. */
export function defaultLibrary(): PieceLibrary {
  cached ??= buildLibrary(BUNDLED_SPECS)
  return cached
}

export function bundledSpecs(): PieceSpec[] {
  return BUNDLED_SPECS.map((spec) => ({ ...spec }))
}
