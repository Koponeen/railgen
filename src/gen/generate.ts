import { buildFillTable, type FillTable } from '../core/fill'
import { Ledger, unlimitedInventory, type Inventory } from '../core/inventory'
import { defaultLibrary, type PieceLibrary } from '../core/library'
import { deriveSeed, makeRng, seedFromInput, seedToString } from '../core/rng'
import type { FlexSettings, VarioSettings } from '../core/vario'
import { materialise, type Track } from './build'
import { bundledElementSpecs, buildElementLibrary, type ElementLibrary, type ElementSpec } from './elements'
import { buildMask, type AreaShape, type CellMask } from './mask'
import { MUTATIONS, type MutationContext } from './mutate'
import { growCycle } from './route'
import { scoreTrack, type ScoreBreakdown } from './score'
import { buildSkeleton, type Skeleton } from './skeleton'

// Generointiputki (README luku 4): aluemaski -> solureitti -> elementtivalinta
// -> mutaatiot -> saumat ja budjettivalidointi -> N ehdokkaan pisteytys.
//
// Käyttäjän siemen on pääsiemen, josta ehdokassiemenet johdetaan
// deterministisesti (R4): sama pääsiemen + asetukset -> sama voittaja.

export interface GenerateOptions {
  seed: string | number
  area: AreaShape
  inventory?: Inventory
  vario?: VarioSettings
  flex?: FlexSettings
  /** Montako ehdokasta arvotaan pääsiemenestä. */
  candidates?: number
  /** Montako mutaatiota per ehdokas yritetään. */
  mutationsPerCandidate?: number
  /** Montako sisäänpistoa kehäkierrokseen yritetään. */
  indents?: number
  /** Asetus "salli kääntö/adapterit"; mäkien edellytys (README luku 2). */
  allowConnectorFlip?: boolean
  library?: PieceLibrary
  elementSpecs?: readonly ElementSpec[]
}

export interface MutationOutcome {
  id: string
  applied: boolean
  reason?: string
}

export interface Candidate {
  seed: number
  skeleton: Skeleton
  track: Track
  score: ScoreBreakdown
  mutations: MutationOutcome[]
}

export interface GenerateResult {
  masterSeed: number
  /** Siemen käyttäjälle näytettävässä ja URL:iin menevässä muodossa. */
  seedLabel: string
  winner: Candidate | null
  candidates: Candidate[]
  /** Miksi hylätyt ehdokkaat hylättiin — rehellinen virheilmoitus käyttäjälle. */
  rejections: string[]
  mask: CellMask
  library: PieceLibrary
  elements: ElementLibrary
  table: FillTable
}

interface Rejection {
  reason: string
  shortfallMm?: number
}

export function generate(options: GenerateOptions): GenerateResult {
  const library = options.library ?? defaultLibrary()
  const inventory = options.inventory ?? unlimitedInventory()
  // Täyttötaulukko rakennetaan vain niistä suorista, joita käyttäjällä on:
  // muuten runko mitoitettaisiin pituuksiin, joita ei voi rakentaa.
  const table = buildFillTable(
    library
      .fillerStraights()
      .filter((piece) => inventory.unlimited || (inventory.counts[piece.id] ?? 0) > 0)
      .map((piece) => piece.straightLengthMm as number),
  )
  const elements = buildElementLibrary(
    options.elementSpecs ?? bundledElementSpecs(),
    library,
    new Ledger(unlimitedInventory()),
  )
  const mask = buildMask(options.area)
  const masterSeed = seedFromInput(options.seed)
  const candidateCount = options.candidates ?? 8
  const mutationCount = options.mutationsPerCandidate ?? 4

  const context = {
    library,
    elements,
    table,
    mask,
    vario: options.vario,
    flex: options.flex,
    allowConnectorFlip: options.allowConnectorFlip,
  }
  const mutationContext: MutationContext = { elements, table }

  const budget = inventoryBudget(inventory, library)
  const candidates: Candidate[] = []
  const rejections: Rejection[] = []

  for (let index = 0; index < candidateCount; index += 1) {
    const seed = deriveSeed(masterSeed, index)
    const rng = makeRng(seed)

    const cycle = growCycle(mask, rng, { indents: options.indents, ...budget })
    if (!cycle) {
      rejections.push({ reason: 'area-too-small' })
      continue
    }

    let skeleton = buildSkeleton(cycle, mask, elements, table, new Ledger(inventory), rng, {})
    if (!skeleton) {
      rejections.push({ reason: 'no-corner-elements-affordable' })
      continue
    }

    let attempt = build(skeleton, context, inventory, seed, 0)
    if (!attempt.track) {
      rejections.push({ reason: attempt.reason, shortfallMm: attempt.shortfallMm })
      continue
    }
    let track = attempt.track

    // Mutaatiot: jokainen validoidaan itsenäisesti ja hylätään siististi jos ei
    // mahdu — runko pysyy aina ehjänä (README luku 4 kohta 4).
    const outcomes: MutationOutcome[] = []
    const mutationRng = makeRng(deriveSeed(seed, 500))
    for (let step = 0; step < mutationCount; step += 1) {
      const mutation = mutationRng.pick(MUTATIONS)
      const result = mutation.apply(skeleton, mutationContext, mutationRng)
      if (!result.ok) {
        outcomes.push({ id: mutation.id, applied: false, reason: result.reason })
        continue
      }
      const mutated = build(result.skeleton, context, inventory, seed, step + 1)
      if (!mutated.track) {
        outcomes.push({ id: mutation.id, applied: false, reason: mutated.reason })
        continue
      }
      skeleton = result.skeleton
      track = mutated.track
      outcomes.push({ id: mutation.id, applied: true })
    }

    candidates.push({
      seed,
      skeleton,
      track,
      score: scoreTrack(track, skeleton, mask, inventory),
      mutations: outcomes,
    })
  }

  // Tasapelit ratkaistaan siemenellä, jotta voittaja on aina sama.
  const winner = candidates.reduce<Candidate | null>((best, candidate) => {
    if (!best) return candidate
    if (candidate.score.total > best.score.total) return candidate
    if (candidate.score.total === best.score.total && candidate.seed < best.seed) return candidate
    return best
  }, null)

  return {
    masterSeed,
    seedLabel: seedToString(masterSeed),
    winner,
    candidates,
    rejections: rejections.map(describeRejection),
    mask,
    library,
    elements,
    table,
  }
}

/**
 * Inventaarion asettamat katot reitille: paljonko rataa on ylipäätään olemassa
 * ja moneenko kulmaan kaaret riittävät. Ilman tätä iso kehä valittaisiin
 * ensin ja hylättäisiin vasta materialisoinnissa.
 */
function inventoryBudget(inventory: Inventory, library: PieceLibrary): { maxPerimeterMm?: number; maxCorners?: number } {
  if (inventory.unlimited) return {}
  let lengthMm = 0
  let curves = 0
  for (const [id, count] of Object.entries(inventory.counts)) {
    if (!library.has(id) || count <= 0) continue
    const piece = library.get(id)
    if (piece.tags.includes('bridge-deck')) continue
    lengthMm += piece.lengthMm * count
    if (piece.kind === 'curve') curves += count
  }
  // Kehä mitataan kulmasolujen keskipisteitä pitkin, joten se on hieman
  // radan todellista pituutta lyhyempi; varataan siitä ~85 %.
  return { maxPerimeterMm: lengthMm * 0.85, maxCorners: Math.floor(curves / 2) }
}

interface BuildAttempt {
  track: Track | null
  reason: string
  shortfallMm?: number
}

function build(
  skeleton: Skeleton,
  context: Parameters<typeof materialise>[1],
  inventory: Inventory,
  seed: number,
  step: number,
): BuildAttempt {
  const ledger = new Ledger(inventory)
  const track = materialise(skeleton, context, ledger, makeRng(deriveSeed(seed, 1000 + step)))
  if (!track) return { track: null, reason: 'inventory-or-placement-failed' }
  if (!track.closure.withinBudget) {
    return { track: null, reason: 'closure-beyond-budget', shortfallMm: track.closure.shortfallMm }
  }
  if (!track.closure.withinCaps) return { track: null, reason: 'joint-over-safety-cap' }
  if (track.collisions > 0) return { track: null, reason: 'self-collision' }
  if (!track.fitsArea) return { track: null, reason: 'outside-area' }
  return { track, reason: 'ok' }
}

function describeRejection(rejection: Rejection): string {
  if (rejection.shortfallMm !== undefined && rejection.shortfallMm > 0) {
    return `${rejection.reason}:${Math.round(rejection.shortfallMm)}mm`
  }
  return rejection.reason
}
