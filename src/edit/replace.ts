import { createInventory, shortagesAgainst, unlimitedInventory, type Inventory } from '../core/inventory'
import { defaultLibrary, type PieceLibrary } from '../core/library'
import type { PlacedPiece } from '../core/pieces'
import type { Vec } from '../core/vec'
import { evaluateClosure, type ClosureReport, type FlexSettings, type Joint, type VarioSettings } from '../core/vario'
import { beamFit, type BeamFit, type FitTuning } from '../fit/beam'
import { cleanDrawing, polylineLength, type CleanOptions } from '../fit/simplify'
import { buildTarget } from '../fit/target'
import { summariseTrack, type Track } from '../gen/build'
import { areaBounds, buildMask, type AreaShape } from '../gen/mask'
import type { Section, TrackChain } from './section'

// Osion korvaus piirtämällä (README luku 6, toteutusjärjestys kohta 3). Sama
// sovituskoneisto kuin tyhjästä piirtämisessä, mutta molemmat päät ovat
// kiinnitettyjä portteja: uuden ketjun on lähdettävä osion alkuportista ja
// päätyttävä sen loppuporttiin täsmälleen samaan suuntaan, tasoon ja
// liittimeen.
//
// Tehtävä on aina ratkaistavissa, koska osio itse on kelvollinen vastaus.
// Siksi epäonnistuminen on aito viesti käyttäjälle eikä algoritmin puute:
// piirretty muoto ei mahdu näihin päätyportteihin.

export type ReplaceReason =
  | 'ok'
  | 'section-not-replaceable'
  | 'drawing-too-short'
  | 'no-fit'
  | 'ends-beyond-budget'
  | 'joint-over-safety-cap'
  | 'self-collision'

export interface ReplaceOptions {
  area: AreaShape
  library?: PieceLibrary
  inventory?: Inventory
  vario?: VarioSettings
  flex?: FlexSettings
  allowConnectorFlip?: boolean
  tuning?: Partial<FitTuning>
  clean?: CleanOptions
}

export interface ReplaceResult {
  /** Koko rata korvauksen jälkeen, tai null jos korvaus ei onnistunut. */
  track: Track | null
  reason: ReplaceReason
  /** Montako palaa osion tilalle tuli. */
  pieceCount: number
  deviation: { meanMm: number; maxMm: number }
  withinInventory: boolean
}

/**
 * Korvattava osuus voi olla lyhyt, joten vapaan piirron 300 mm:n minimi olisi
 * tässä väärä. Tätä lyhyempi veto on silti vahinko, ei muoto.
 */
export const MIN_SECTION_DRAWING_MM = 60

/**
 * Vedon on myös yletyttävä portilta portille: päät ankkuroidaan kiinnitettyihin
 * portteihin, joten osion keskelle raapaistu töherrys venyisi muuten viivaksi,
 * joka hyppää portilta töherryksen luo ja takaisin.
 */
const MIN_SPAN_RATIO = 0.6

/**
 * Näin kauas kiinnitetystä päätyportista ketju saa jäädä; loppuheiton nielee
 * Vario-budjetti, joka tarkistetaan erikseen kattoineen.
 */
const GOAL_TOLERANCE_MM = 40

/**
 * Kiinnitetty pääty on ahtaampi tehtävä kuin vapaa veto: keila pidetään
 * leveämpänä ja ehdokkaita palautetaan enemmän, koska ratkaisevaa ei ole vain
 * viivan seuraaminen vaan se, että ketju osuu porttiin.
 */
const SECTION_TUNING: Partial<FitTuning> = { beamWidth: 16, resultLimit: 24, corridorMm: 120 }

function failure(reason: ReplaceReason): ReplaceResult {
  return { track: null, reason, pieceCount: 0, deviation: { meanMm: 0, maxMm: 0 }, withinInventory: true }
}

/**
 * Sovittaa piirretyn viivan valitun osion tilalle. Alkuperäinen rata jää
 * koskemattomaksi: epäonnistunut korvaus palauttaa vain syyn (CLAUDE.md —
 * rata on joka välivaiheessa ehjä).
 */
export function replaceSection(
  track: Track,
  section: Section,
  rawPoints: readonly Vec[],
  options: ReplaceOptions,
): ReplaceResult {
  const library = options.library ?? defaultLibrary()
  const inventory = options.inventory ?? unlimitedInventory()
  if (!section.replaceable) return failure('section-not-replaceable')

  const spanMm = distance(section.start, section.end)
  const minLengthMm = Math.max(MIN_SECTION_DRAWING_MM, spanMm * MIN_SPAN_RATIO)
  const drawing = cleanDrawing(rawPoints, options.clean)
  if (!drawing || drawing.lengthMm < minLengthMm) return failure('drawing-too-short')

  // Piirretty viiva on aikomus, ei komento: sen saa vetää kummasta päästä
  // tahansa, ja päät ankkuroidaan kiinnitettyihin portteihin.
  const points = orient(drawing.points, section)
  points[0] = { x: section.start.x, y: section.start.y }
  points[points.length - 1] = { x: section.end.x, y: section.end.y }
  const target = buildTarget({ points, closed: false, lengthMm: polylineLength(points) })

  const bounds = areaBounds(buildMask(options.area))

  const attempt = (attemptInventory: Inventory, within: boolean): ReplaceResult | null => {
    const fits = beamFit(target, {
      library,
      inventory: attemptInventory,
      tuning: { ...SECTION_TUNING, ...options.tuning },
      allowConnectorFlip: options.allowConnectorFlip,
      start: [section.start],
      goal: { frame: section.end, toleranceMm: GOAL_TOLERANCE_MM },
    })

    let firstReason: ReplaceReason | null = null
    const built: { result: ReplaceResult; gapMm: number }[] = []

    for (const fit of fits) {
      const assembled = assemble(track, section, fit, library, inventory, bounds, options)
      if (assembled.result.track) built.push({ result: { ...assembled.result, withinInventory: within }, gapMm: assembled.gapMm })
      else firstReason ??= assembled.result.reason
    }

    if (built.length === 0) return firstReason ? failure(firstReason) : null

    // Pienin päätyheitto voittaa: se on suoraan pois Vario-budjetista.
    // Sovituskustannus keilahausta ratkaisee tasapelit vakaana lajitteluna.
    built.sort((a, b) => a.gapMm - b.gapMm)
    return built[0].result
  }

  const own = attempt(availableInventory(track, section, inventory), true)
  if (own?.track) return own
  if (inventory.unlimited) return own ?? failure('no-fit')

  // Omat palat eivät riittäneet: sovitetaan rajattomilla ja kerrotaan puutteet.
  const relaxed = attempt(unlimitedInventory(), false)
  if (relaxed?.track) return relaxed
  return own ?? relaxed ?? failure('no-fit')
}

/** Piirron suunta osion suuntaiseksi. */
function orient(points: readonly Vec[], section: Section): Vec[] {
  const head = points[0]
  const tail = points[points.length - 1]
  const forward = distance(head, section.start) + distance(tail, section.end)
  const backward = distance(head, section.end) + distance(tail, section.start)
  return backward < forward ? [...points].reverse() : [...points]
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Mitä paloja korvaukseen on käytettävissä: käyttäjän kokoelma miinus se, mikä
 * on kiinni muualla radalla. Purettava osio vapauttaa palansa takaisin
 * (README luku 6: "inventaario + purkamisesta vapautuvat palat").
 */
export function availableInventory(track: TrackChain, section: Section, inventory: Inventory): Inventory {
  return availableExcluding(track, new Set(section.indices), inventory)
}

/**
 * Sama laskenta mielivaltaiselle purettavalle joukolle: lisäävä piirto purkaa
 * suoran osuuden mahduttaakseen vaihteen keskelle, eikä sillä ole osiota.
 */
export function availableExcluding(track: TrackChain, inside: ReadonlySet<number>, inventory: Inventory): Inventory {
  if (inventory.unlimited) return inventory
  const elsewhere: Record<string, number> = {}
  track.pieces.forEach((placed, index) => {
    if (inside.has(index)) return
    elsewhere[placed.pieceId] = (elsewhere[placed.pieceId] ?? 0) + 1
  })

  const counts: Record<string, number> = {}
  for (const [id, count] of Object.entries(inventory.counts)) {
    counts[id] = Math.max(0, count - (elsewhere[id] ?? 0))
  }
  return createInventory(counts)
}

interface Assembled {
  result: ReplaceResult
  gapMm: number
}

function assemble(
  track: Track,
  section: Section,
  fit: BeamFit,
  library: PieceLibrary,
  inventory: Inventory,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  options: ReplaceOptions,
): Assembled {
  // Sovitus siirtää paloja sulkeutuessaan, joten ketjusta otetaan oma kopio.
  const pieces: PlacedPiece[] = fit.pieces.map((placed) => ({ ...placed, placement: { ...placed.placement } }))
  if (pieces.length === 0) return { result: failure('no-fit'), gapMm: Infinity }

  const gap: Vec = { x: fit.end.x - section.end.x, y: fit.end.y - section.end.y }
  const gapMm = Math.hypot(gap.x, gap.y)
  relaxSection(pieces, gap)

  const spliced = splice(track, section, pieces)

  // Päätyheitto kuuluu osion omille liitoksille, ei koko radalle: se on
  // syntynyt tässä ja sen on mahduttava tähän. Suuntaheittoa ei ole, koska
  // keilahaku hyväksyi vain oikeaan lokeroon osuvat ketjut.
  const local = evaluateClosure(jointsOf(spliced.pieces, spliced.localJoints, library), { gapMm, angleDeg: 0 }, {
    settings: options.vario,
    flex: options.flex,
  })
  if (!local.withinBudget) return { result: failure('ends-beyond-budget'), gapMm }
  if (!local.withinCaps) return { result: failure('joint-over-safety-cap'), gapMm }

  const usage = countUsage(spliced.pieces)
  const next = summariseTrack(
    {
      pieces: spliced.pieces,
      joints: spliced.joints,
      closure: combinedClosure(track, spliced, gapMm, library, options),
      usage,
      shortages: shortagesAgainst(usage, inventory),
      areaBounds: bounds,
    },
    library,
  )

  // Korvaus ei saa tuoda uutta törmäystä. Vertailu alkuperäiseen eikä nollaan,
  // koska monitasoisessa radassa laskuri voi olla valmiiksi nollaa suurempi.
  if (next.collisions > track.collisions) return { result: failure('self-collision'), gapMm }

  return {
    result: {
      track: next,
      reason: 'ok',
      pieceCount: pieces.length,
      deviation: fit.deviation,
      withinInventory: true,
    },
    gapMm,
  }
}

/**
 * Jakaa päätyheiton osion liitoksille. Osiossa on n palaa ja n+1 liitosta
 * (molemmat päätyliitokset mukaan lukien), joten pala i siirretään osuudella
 * `(i+1)/(n+1)`: alkupää avautuu yhtä paljon kuin loppupää, eikä kumpikaan
 * kiinnitetty portti liiku. Sama malli kuin silmukan sauman `relaxClosure`,
 * nyt kahden kiinteän pään välissä.
 */
export function relaxSection(pieces: PlacedPiece[], gap: Vec): void {
  const count = pieces.length
  for (let i = 0; i < count; i += 1) {
    const share = (i + 1) / (count + 1)
    const { placement } = pieces[i]
    pieces[i] = {
      ...pieces[i],
      placement: { ...placement, x: placement.x - gap.x * share, y: placement.y - gap.y * share },
    }
  }
}

interface Spliced {
  pieces: PlacedPiece[]
  joints: [number, number][]
  /** Osion tilalle tulleiden palojen liitokset, päätyliitokset mukaan lukien. */
  localJoints: [number, number][]
}

/**
 * Vaihtaa osion palat uusiin ja rakentaa liitoslistan uudelleen. Muut palat
 * säilyttävät keskinäisen järjestyksensä, uudet tulevat listan loppuun.
 */
export function splice(track: TrackChain, section: Section, replacement: readonly PlacedPiece[]): Spliced {
  const inside = new Set(section.indices)
  const remap = new Map<number, number>()
  const pieces: PlacedPiece[] = []

  track.pieces.forEach((placed, index) => {
    if (inside.has(index)) return
    remap.set(index, pieces.length)
    pieces.push(placed)
  })

  const first = pieces.length
  const last = first + replacement.length - 1
  pieces.push(...replacement)

  const joints: [number, number][] = []
  for (const [a, b] of track.joints) {
    if (inside.has(a) || inside.has(b)) continue
    joints.push([remap.get(a) as number, remap.get(b) as number])
  }

  const localJoints: [number, number][] = []
  for (let i = first; i < last; i += 1) localJoints.push([i, i + 1])
  if (section.before !== null) localJoints.push([remap.get(section.before) as number, first])
  if (section.after !== null) localJoints.push([remap.get(section.after) as number, last])

  return { pieces, joints: [...joints, ...localJoints], localJoints }
}

/** Liitosten joustokertoimet: liitos joustaa kahden palansa keskiarvon verran. */
export function jointsOf(pieces: readonly PlacedPiece[], joints: readonly [number, number][], library: PieceLibrary): Joint[] {
  return joints.map(([a, b]) => ({
    varioFactor: (library.get(pieces[a].pieceId).varioFactor + library.get(pieces[b].pieceId).varioFactor) / 2,
  }))
}

/**
 * Koko radan sulkeutumisraportti korvauksen jälkeen. Silmukan alkuperäinen
 * sauma on yhä olemassa ja kuluttaa oman osuutensa Variosta, ja korvaus lisää
 * siihen oman päätyheittonsa — kireysprosentti kertoo yhteissumman.
 */
function combinedClosure(
  track: Track,
  spliced: Spliced,
  gapMm: number,
  library: PieceLibrary,
  options: ReplaceOptions,
): ClosureReport {
  return evaluateClosure(
    jointsOf(spliced.pieces, spliced.joints, library),
    { gapMm: track.closure.error.gapMm + gapMm, angleDeg: track.closure.error.angleDeg },
    { settings: options.vario, flex: options.flex },
  )
}

function countUsage(pieces: readonly PlacedPiece[]): Record<string, number> {
  const usage: Record<string, number> = {}
  for (const placed of pieces) usage[placed.pieceId] = (usage[placed.pieceId] ?? 0) + 1
  return usage
}
