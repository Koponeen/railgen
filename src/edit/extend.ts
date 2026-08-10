import { inventoryFillTable, type FillTable } from '../core/fill'
import { Ledger, createInventory, unlimitedInventory, type Inventory } from '../core/inventory'
import { defaultLibrary, type PieceLibrary } from '../core/library'
import { samplePath } from '../core/path'
import { placedSegments, type Frame, type PlacedPiece } from '../core/pieces'
import type { Vec } from '../core/vec'
import type { FlexSettings, VarioSettings } from '../core/vario'
import { beamFit, type BeamFit, type FitTuning } from '../fit/beam'
import { cleanDrawing, polylineLength, type CleanOptions } from '../fit/simplify'
import { buildTarget } from '../fit/target'
import type { Track } from '../gen/build'
import { buildElementLibrary, bundledElementSpecs, type ElementLibrary } from '../gen/elements'
import { areaBounds, buildMask, type AreaShape } from '../gen/mask'
import { assembleTrack, countUsage } from './assemble'
import { branchAnchors, BRANCH_SNAP_MM, type BranchAnchor } from './branch'
import { bridgeOver, findCrossings, levelCrossings, type CrossingSite } from './crossing'
import type { TrackChain } from './section'

// Lisäävä piirto (README luku 5 "Haara mutkaan", luku 6 "risteämiskyselyt").
// Radan vierestä alkava veto ei ole uusi rata vaan uusi haara: se etsii
// itselleen haarakohdan (branch.ts), sovittautuu siitä eteenpäin samalla
// keilahaulla kuin muukin piirto ja ratkaisee matkalla tulevan risteämän
// (crossing.ts).
//
// Epäselvyyttä ei ratkaista dialogilla: jos yksi vaihtoehto voittaa selvästi,
// se toteutetaan suoraan, ja muuten palautetaan 2–3 vaihtoehtoa
// haamuesikatseluiksi kartalle (README luku 6).

export type ExtendReason =
  | 'ok'
  | 'drawing-too-short'
  | 'not-on-track'
  | 'no-branch-point'
  | 'no-fit'
  | 'ends-beyond-budget'
  | 'joint-over-safety-cap'
  | 'self-collision'
  | 'crossing-unresolved'

export interface ExtendOptions {
  area: AreaShape
  library?: PieceLibrary
  elements?: ElementLibrary
  inventory?: Inventory
  vario?: VarioSettings
  flex?: FlexSettings
  allowConnectorFlip?: boolean
  tuning?: Partial<FitTuning>
  clean?: CleanOptions
  /** Nappausetäisyys radasta; tätä kauempaa alkava veto on uusi rata. */
  snapMm?: number
  /** Montako vaihtoehtoa palautetaan haamuesikatseluiksi. */
  maxOptions?: number
}

/** Yksi tapa liittää piirretty haara rataan. */
export interface BranchOption {
  track: Track
  /** Haarapalan tunnus, esim. "L". */
  junctionId: string
  /** Tuliko haara suoralle osuudelle vai kaaren tilalle? */
  kind: BranchAnchor['kind']
  /** Miten risteämä ratkaistiin, jos sellainen tuli vastaan. */
  crossing: 'none' | 'level' | 'bridge'
  /** Risteyspalan tai siltaelementin tunnus. */
  crossingId: string | null
  /** Uusien ja muuttuneiden palojen indeksit — haamuesikatselu piirtää nämä. */
  addedIndices: number[]
  /** Palamuutoskortti (README luku 6): "käyttää 1×L · vapauttaa 1×D". */
  added: Record<string, number>
  removed: Record<string, number>
  /** Montako palaa haaraan tuli. */
  pieceCount: number
  deviation: { meanMm: number; maxMm: number }
  withinInventory: boolean
  cost: number
}

export interface ExtendResult {
  options: BranchOption[]
  reason: ExtendReason
  /**
   * Voittiko yksi vaihtoehto niin selvästi, että sen voi toteuttaa suoraan?
   * Risteämä ei koskaan ratkea automaattisesti — se on aito kysymys.
   */
  automatic: boolean
}

/** Haaran saa piirtää lyhyeksikin: sivuraide on usein vain pätkä. */
export const MIN_BRANCH_DRAWING_MM = 120

/** Näin monta haarakohtaa sovitetaan; jokainen maksaa oman keilahakunsa. */
const MAX_ANCHORS = 6

/** Näin monta keilahaun ketjua arvioidaan per haarakohta. */
const MAX_FITS = 4

/** Voittaja on selvä, jos se on tämän verran halvempi kuin seuraava. */
const AUTO_MARGIN = 0.7

/** Risteämän ratkaisun hinta: tasoristeys on kevyempi kuin silta. */
const LEVEL_CROSSING_COST = 400
const BRIDGE_COST = 700

/** Lyhyempi jakso risteämän jälkeen on mittausvirhe, ei aikomus. */
const MIN_LEG_MM = 60

/** Kiinnitetystä päätyportista saa jäädä näin kauas; loput nielee Vario. */
const GOAL_TOLERANCE_MM = 40

/** Haaran keila pidetään kapeana: se on lyhyt eikä sen tarvitse etsiä saumaa. */
const BRANCH_TUNING: Partial<FitTuning> = { beamWidth: 12, resultLimit: 8 }

let cachedElements: ElementLibrary | null = null

function defaultElements(library: PieceLibrary): ElementLibrary {
  cachedElements ??= buildElementLibrary(bundledElementSpecs(), library, new Ledger(unlimitedInventory()))
  return cachedElements
}

function failure(reason: ExtendReason): ExtendResult {
  return { options: [], reason, automatic: false }
}

interface Context {
  track: Track
  library: PieceLibrary
  elements: ElementLibrary
  inventory: Inventory
  table: FillTable
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  options: ExtendOptions
}

/**
 * Sovittaa piirretyn viivan uudeksi haaraksi valmiiseen rataan. Alkuperäinen
 * rata jää koskemattomaksi: epäonnistunut yritys palauttaa vain syyn
 * (CLAUDE.md — rata on joka välivaiheessa ehjä).
 */
export function extendTrack(track: Track, rawPoints: readonly Vec[], options: ExtendOptions): ExtendResult {
  const library = options.library ?? defaultLibrary()
  const inventory = options.inventory ?? unlimitedInventory()
  const snapMm = options.snapMm ?? BRANCH_SNAP_MM

  const drawing = cleanDrawing(rawPoints, options.clean)
  if (!drawing || drawing.lengthMm < MIN_BRANCH_DRAWING_MM) return failure('drawing-too-short')

  // Vedon saa aloittaa kummasta päästä tahansa: radan lähempi pää on haaran
  // juuri, toinen sen vapaa pää.
  const points = orientFromTrack(drawing.points, track, library, snapMm)
  if (!points) return failure('not-on-track')

  const table = inventoryFillTable(library, inventory)
  const anchors = branchAnchors(track, library, table, inventory, points[0], { snapMm, limit: MAX_ANCHORS })
  if (anchors.length === 0) return failure('no-branch-point')

  const context: Context = {
    track,
    library,
    elements: options.elements ?? defaultElements(library),
    inventory,
    table,
    bounds: areaBounds(buildMask(options.area)),
    options,
  }

  const built: BranchOption[] = []
  let firstReason: ExtendReason | null = null

  for (const anchor of anchors) {
    const fits = fitLeg(context, anchor.pieces, anchor.frame, points, null)
    if (fits.length === 0) {
      firstReason ??= 'no-fit'
      continue
    }

    let plain: BranchOption | null = null
    for (const fit of fits.slice(0, MAX_FITS)) {
      const assembled = attach(context, anchor, [{ pieces: fit.pieces, from: anchor.junctionIndex }], {
        crossing: 'none',
        crossingId: null,
        deviation: fit.deviation,
        extraCost: fit.cost,
      })
      if (assembled.option) {
        plain = assembled.option
        break
      }
      firstReason ??= assembled.reason
    }
    if (plain) {
      built.push(plain)
      continue
    }

    // Ketju leikkaa vanhan radan: se on aito aikomus, ja siihen on kaksi
    // vastausta (README luku 6). Kumpaakin tarjotaan omana vaihtoehtonaan.
    // Vain yksi risteämä kerrallaan: useampi ylitys yhdellä vedolla on
    // kysymys, johon ei ole yhtä vastausta, ja se sanotaan suoraan.
    const sites = findCrossings(anchor.pieces, fits[0].pieces, library, [[anchor.junctionIndex, 0]])
    if (sites.length !== 1) {
      if (sites.length > 1) firstReason = 'crossing-unresolved'
      continue
    }
    const resolved = [
      ...levelOptions(context, anchor, points, sites[0]),
      ...bridgeOptions(context, anchor, fits[0], sites[0]),
    ]
    if (resolved.length === 0) firstReason = 'crossing-unresolved'
    built.push(...resolved)
  }

  if (built.length === 0) return failure(firstReason ?? 'no-fit')

  const ranked = rank(built, options.maxOptions ?? 3)
  // Risteämä on aito kysymys eikä ratkea itsestään, joten sen sisältävä
  // vaihtoehtojoukko menee aina käyttäjälle asti.
  const automatic =
    ranked.every((option) => option.crossing === 'none') &&
    (ranked.length === 1 || ranked[0].cost <= ranked[1].cost * AUTO_MARGIN)
  return { options: ranked, reason: 'ok', automatic }
}

// --- Sovitus ----------------------------------------------------------------

/**
 * Sovittaa yhden jakson piirretystä viivasta annetusta kehyksestä eteenpäin.
 * Käytettävissä oleva kokoelma on käyttäjän palat miinus se, mikä on jo
 * kiinni radalla — sama sääntö kuin osion korvauksessa.
 */
function fitLeg(
  context: Context,
  base: readonly PlacedPiece[],
  start: Frame,
  points: readonly Vec[],
  goal: Frame | null,
): BeamFit[] {
  if (points.length < 2 || polylineLength(points) < MIN_LEG_MM) return []
  const anchored = [{ x: start.x, y: start.y }, ...points.slice(1)]
  if (goal) anchored[anchored.length - 1] = { x: goal.x, y: goal.y }

  return beamFit(buildTarget({ points: anchored, closed: false, lengthMm: polylineLength(anchored) }), {
    library: context.library,
    inventory: minus(context.inventory, countUsage(base)),
    tuning: { ...BRANCH_TUNING, ...context.options.tuning },
    allowConnectorFlip: context.options.allowConnectorFlip,
    start: [start],
    goal: goal ? { frame: goal, toleranceMm: GOAL_TOLERANCE_MM } : undefined,
  })
}

interface Leg {
  pieces: PlacedPiece[]
  /** Mihin pohjaradan palaan jakson ensimmäinen pala liittyy. */
  from: number
  /** Mihin pohjaradan palaan jakson viimeinen pala liittyy (risteyksen kohdalla). */
  to?: number
}

interface Attached {
  option: BranchOption | null
  reason: ExtendReason
}

/**
 * Kokoaa pohjaradan ja haarajaksot yhdeksi radaksi ja tarkistaa, ettei se riko
 * mitään: päätyheiton on mahduttava budjettiin, liitosten turvakaton alle, eikä
 * uusia törmäyksiä saa syntyä.
 */
function attach(
  context: Context,
  anchor: BranchAnchor,
  legs: Leg[],
  meta: {
    crossing: BranchOption['crossing']
    crossingId: string | null
    deviation: { meanMm: number; maxMm: number }
    extraCost: number
    base?: TrackChain
    gapMm?: number
    localJoints?: readonly [number, number][]
  },
): Attached {
  const { library, options } = context
  const base = meta.base ?? { pieces: anchor.pieces, joints: anchor.joints }
  const gapMm = meta.gapMm ?? anchor.gapMm
  const localJoints = meta.localJoints ?? anchor.localJoints

  const pieces: PlacedPiece[] = base.pieces.map((placed) => ({ ...placed, placement: { ...placed.placement } }))
  const joints: [number, number][] = base.joints.map(([a, b]) => [a, b])
  let branchCount = 0

  for (const leg of legs) {
    if (leg.pieces.length === 0) continue
    const first = pieces.length
    pieces.push(...leg.pieces.map((placed) => ({ ...placed, placement: { ...placed.placement } })))
    branchCount += leg.pieces.length
    for (let i = first + 1; i < pieces.length; i += 1) joints.push([i - 1, i])
    joints.push([leg.from, first])
    if (leg.to !== undefined) joints.push([pieces.length - 1, leg.to])
  }
  if (branchCount === 0) return { option: null, reason: 'no-fit' }

  // Haarakohdan päätyheitto kuuluu sen omalle osuudelle: se on syntynyt siinä
  // ja sen on mahduttava siihen (sama malli kuin osion korvauksessa).
  const assembled = assembleTrack(
    context.track,
    { pieces, joints, localJoints, gapMm },
    { library, inventory: context.inventory, vario: options.vario, flex: options.flex, bounds: context.bounds },
  )
  const next = assembled.track
  if (!next) return { option: null, reason: assembled.reason }

  const removed = { ...anchor.removed }
  const added = { ...anchor.added }
  for (const leg of legs) for (const placed of leg.pieces) added[placed.pieceId] = (added[placed.pieceId] ?? 0) + 1

  return {
    option: {
      track: next,
      junctionId: anchor.junctionId,
      kind: anchor.kind,
      crossing: meta.crossing,
      crossingId: meta.crossingId,
      addedIndices: newPieceIndices(context.track, next),
      added,
      removed,
      pieceCount: branchCount,
      deviation: meta.deviation,
      withinInventory: Object.keys(next.shortages).length === 0,
      cost: anchor.cost + meta.extraCost,
    },
    reason: 'ok',
  }
}

// --- Risteämän ratkaisu ------------------------------------------------------

/** Silta: uusi ketju nostetaan vanhan radan yli mäkielementillä. */
function bridgeOptions(context: Context, anchor: BranchAnchor, fit: BeamFit, site: CrossingSite): BranchOption[] {
  const bridged = bridgeOver(
    fit.pieces,
    context.library,
    context.elements,
    context.table,
    minus(context.inventory, countUsage(anchor.pieces)),
    site,
  )
  if (!bridged) return []

  const attached = attach(context, anchor, [{ pieces: bridged.pieces, from: anchor.junctionIndex }], {
    crossing: 'bridge',
    crossingId: bridged.elementId,
    deviation: fit.deviation,
    extraCost: fit.cost + BRIDGE_COST,
    gapMm: anchor.gapMm + bridged.gapMm,
  })
  return attached.option ? [attached.option] : []
}

/**
 * Tasoristeys: risteyspala upotetaan vanhalle radalle ja uusi ketju sovitetaan
 * sen läpi kahtena jaksona. Ensimmäinen jakso päättyy risteyksen porttiin
 * täsmälleen, toinen jatkaa vapaana viivan loppuun.
 */
function levelOptions(context: Context, anchor: BranchAnchor, points: readonly Vec[], site: CrossingSite): BranchOption[] {
  const base: TrackChain = { pieces: anchor.pieces, joints: anchor.joints }
  const results: BranchOption[] = []

  // Haara kulkee koko matkan samalla liitinparillisuudella, joten risteyksen
  // on otettava se vastaan — muuten pala ei mene kiinni.
  for (const crossing of levelCrossings(base, context.library, context.table, context.inventory, site, anchor.frame.open)) {
    // Risteyspalan upotus siirsi pohjaradan indeksejä; haarapala löytyy siitä
    // mihin `splice` sen jätti, joten se etsitään sijainnin perusteella.
    const junctionIndex = indexOfPlacement(crossing.pieces, anchor.pieces[anchor.junctionIndex])
    if (junctionIndex === null) continue

    const split = splitAt(points, crossing.inFrame)
    const head = fitLeg(context, crossing.pieces, anchor.frame, split.head, crossing.inFrame)
    if (head.length === 0) continue

    const legs: Leg[] = [{ pieces: head[0].pieces, from: junctionIndex, to: crossing.crossingIndex }]
    let deviation = head[0].deviation
    let cost = head[0].cost

    const tail = fitLeg(context, [...crossing.pieces, ...head[0].pieces], crossing.outFrame, split.tail, null)
    if (tail.length > 0) {
      legs.push({ pieces: tail[0].pieces, from: crossing.crossingIndex })
      deviation = {
        meanMm: (deviation.meanMm + tail[0].deviation.meanMm) / 2,
        maxMm: Math.max(deviation.maxMm, tail[0].deviation.maxMm),
      }
      cost += tail[0].cost
    }

    const attached = attach(context, anchor, legs, {
      crossing: 'level',
      crossingId: crossing.crossingId,
      deviation,
      extraCost: cost + LEVEL_CROSSING_COST,
      base: { pieces: crossing.pieces, joints: crossing.joints },
      gapMm: anchor.gapMm + crossing.gapMm,
      localJoints: crossing.localJoints,
    })
    if (attached.option) {
      results.push({
        ...attached.option,
        added: mergeCounts(attached.option.added, crossing.added),
        removed: mergeCounts(attached.option.removed, crossing.removed),
      })
    }
  }
  return results
}

/** Katkaisee piirretyn viivan kohdasta, jossa se ylittää radan. */
function splitAt(points: readonly Vec[], at: Vec): { head: Vec[]; tail: Vec[] } {
  let bestIndex = 1
  let bestT = 0
  let best = Infinity

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]
    const to = points[i]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - from.x) * dx + (at.y - from.y) * dy) / lengthSq))
    const distance = Math.hypot(at.x - (from.x + dx * t), at.y - (from.y + dy * t))
    if (distance < best) {
      best = distance
      bestIndex = i
      bestT = t
    }
  }

  const from = points[bestIndex - 1]
  const to = points[bestIndex]
  const cut: Vec = { x: from.x + (to.x - from.x) * bestT, y: from.y + (to.y - from.y) * bestT }
  return { head: [...points.slice(0, bestIndex), cut], tail: [cut, ...points.slice(bestIndex)] }
}

// --- Apurit ------------------------------------------------------------------

/**
 * Kääntää vedon niin, että sen alku on radalla. Jos kumpikaan pää ei ole
 * nappausetäisyydellä, veto ei ole haara vaan uusi rata.
 */
function orientFromTrack(points: readonly Vec[], track: Track, library: PieceLibrary, snapMm: number): Vec[] | null {
  const head = distanceToTrack(points[0], track, library)
  const tail = distanceToTrack(points[points.length - 1], track, library)
  if (Math.min(head, tail) > snapMm) return null
  return tail < head ? [...points].reverse() : [...points]
}

/** Kuinka lähellä rataa piste on. Sivun 3 logiikka päättää tästä, onko veto haara vai uusi rata. */
export function distanceToTrack(point: Vec, track: TrackChain, library: PieceLibrary): number {
  let best = Infinity
  for (const placed of track.pieces) {
    const piece = library.get(placed.pieceId)
    for (const sample of samplePath(placedSegments(placed, piece), 20)) {
      const distance = Math.hypot(sample.x - point.x, sample.y - point.y)
      if (distance < best) best = distance
    }
  }
  return best
}

/** Kokoelma, josta jo käytetty on vähennetty. */
function minus(inventory: Inventory, usage: Record<string, number>): Inventory {
  if (inventory.unlimited) return inventory
  const counts: Record<string, number> = {}
  for (const [id, count] of Object.entries(inventory.counts)) counts[id] = Math.max(0, count - (usage[id] ?? 0))
  return createInventory(counts)
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const merged = { ...a }
  for (const [id, count] of Object.entries(b)) merged[id] = (merged[id] ?? 0) + count
  return merged
}

function placementKey(placed: PlacedPiece): string {
  const { x, y, rot, mirror, level } = placed.placement
  return `${placed.pieceId}|${x.toFixed(1)}|${y.toFixed(1)}|${rot}|${mirror}|${level}`
}

/**
 * Mitkä palat ovat uusia tai siirtyneitä. Vertailu tehdään sijoituksista eikä
 * indekseistä, koska osuuden uudelleentäyttö järjestää taulukon uusiksi —
 * koskematon pala on täsmälleen siellä missä ennenkin.
 */
export function newPieceIndices(before: TrackChain, after: TrackChain): number[] {
  const remaining = new Map<string, number>()
  for (const placed of before.pieces) {
    const key = placementKey(placed)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }

  const indices: number[] = []
  after.pieces.forEach((placed, index) => {
    const key = placementKey(placed)
    const count = remaining.get(key) ?? 0
    if (count > 0) remaining.set(key, count - 1)
    else indices.push(index)
  })
  return indices
}

/** Saman sijoituksen indeksi toisessa palalistassa. */
function indexOfPlacement(pieces: readonly PlacedPiece[], target: PlacedPiece): number | null {
  const key = placementKey(target)
  const index = pieces.findIndex((placed) => placementKey(placed) === key)
  return index >= 0 ? index : null
}

/**
 * Paras ensin, ja vain yksi vaihtoehto per haarapalan ja risteämäratkaisun
 * yhdistelmä: kaksi lähes samanlaista haamua kartalla ei ole valinta vaan sotku.
 */
function rank(options: readonly BranchOption[], limit: number): BranchOption[] {
  const seen = new Set<string>()
  return [...options]
    .sort((a, b) => a.cost - b.cost || a.junctionId.localeCompare(b.junctionId))
    .filter((option) => {
      const key = `${option.junctionId}|${option.kind}|${option.crossing}|${option.crossingId ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}
