import bundled from '../../data/variations/basic.json'
import { oppositeDir } from '../core/dir'
import { fillableLengths, solveFill, type FillTable } from '../core/fill'
import { Ledger, type Inventory } from '../core/inventory'
import type { PieceLibrary } from '../core/library'
import { samplePath } from '../core/path'
import {
  placeAtFrame,
  placeTerminal,
  placedSegments,
  startFrame,
  type Frame,
  type PlacedPiece,
} from '../core/pieces'
import { complementOf, transformPort, type Port } from '../core/ports'
import { makeRng } from '../core/rng'
import { EPS_MM } from '../core/units'

// Autosolverin variaatiokuviokirjasto (README luku 6). Kuviot ovat **dataa**
// (`data/variations/`), aivan kuten palat ja elementit: uusi kuvio on rivi
// JSONia eikä koodimuutos.
//
// Kuvio on osuuden **ydin**: se lähtee osuuden alkuportista, päätyy samaan
// suuntaan samalle tasolle eikä siirry sivusuunnassa, jolloin loppu osuudesta
// täytetään suorilla sen molemmin puolin (`insertIntoRun`). Sama upotus-ja-täytä
// -koneisto kuin vaihteella, risteyksellä ja sillalla.
//
// Kaksi asiaa tekee kuviosta parametrisen:
//
// 1. **Täyttöaskeleet** (`fill`) ovat pituusvälejä, eivät paloja. Sivuraiteen
//    pituus ja ohituskaiteen rinnakkaissuora valitaan vasta kun tiedetään
//    paljonko tilaa on.
// 2. **Linkki** (`link`) sulkee umpisilmukan: sivuraide palaa toiseen
//    vaihteeseen. Geometria tarkistaa sulkeutumisen, joten datassa ei tarvitse
//    laskea mitään käsin — väärä kuvio ei vain ratkea.
//
// Kaaripohjaiset kuviot eivät osu 18 mm:n mikrogridiin (45° → √2), joten niiden
// täyttö napsautetaan lähimpään täytettävään pituuteen ja jäännös jää Varion
// nieltäväksi. Se on sama toleranssibudjetti kuin silmukan saumassa, ja se
// tarkistetaan kattoineen ennen kuin kuviota tarjotaan.

export interface VariationFillSpec {
  minMm?: number
  maxMm?: number
}

export interface VariationPieceStep {
  piece: string
  /** Peilaa palan: kaari toiseen suuntaan. */
  mirror?: boolean
  /** Kuljetaan pala väärinpäin — laskeva ramppi ja takaperin ajettava vaihde. */
  reverse?: boolean
  /** Sivuhaara: palat, jotka asennetaan tämän palan haaraporttiin. */
  branch?: { portId: string; steps: VariationStep[] }
}

/** Parametrinen väli: pituus valitaan täyttötaulukosta vasta osuudella. */
export interface VariationFillStep {
  fill: VariationFillSpec
}

export type VariationStep = VariationPieceStep | VariationFillStep

/** Umpisilmukka: sivuraide lähtee portista ja palaa toiseen porttiin. */
export interface VariationLink {
  from: { step: number; portId: string }
  to: { step: number; portId: string }
  steps: VariationStep[]
}

export interface VariationSpec {
  id: string
  /** Kuviotyyppi; monipuolisuuspisteytys ja käännösavaimet menevät tämän mukaan. */
  kind: string
  steps: VariationStep[]
  link?: VariationLink
  tags?: string[]
  notes?: string
}

/** Sulkeutuva sivuraide ei osu porttiin täsmälleen; tätä isompi jää tarjoamatta. */
const LINK_TOLERANCE_MM = 12

/** Ytimen on päädyttävä samalle linjalle: tätä isompi sivusiirtymä ei ole ydin. */
const THROUGH_TOLERANCE_MM = 1

/** Näin monta pituusehdokasta per täyttöaskel. */
const MAX_FILL_CANDIDATES = 24

/** Näin monta pituusyhdistelmää kokeillaan; loput ovat saman kuvion toistoa. */
const MAX_COMBOS = 256

/** Näin monelle parhaalle yhdistelmälle etsitään oikeat palat. */
const MAX_BUILDS = 3

/**
 * Täytön arvonta on siemennetty vakiolla: autosolver on sovitusta, ja sovitus
 * on täysin deterministinen. Sama osuus tuottaa aina samat vaihtoehdot.
 */
const FILL_SEED = 0x5017e6

const CANONICAL_START = startFrame(0, 0, 0, 0, 'pin')

export function bundledVariationSpecs(): VariationSpec[] {
  return bundled as VariationSpec[]
}

// --- Suunnitelma: kuvio konkreettisina paloina --------------------------------

/**
 * Yksi askel valmiissa suunnitelmassa. `advance` on täyttöaskel, jonka pituus
 * tunnetaan muttei vielä paloja: geometria ratkaistaan ensin ja palat vasta
 * sitten, koska pituusyhdistelmiä on kymmeniä ja niistä valtaosa karsiutuu jo
 * geometriaan.
 */
type PlanStep =
  | { kind: 'advance'; lengthMm: number }
  | {
      kind: 'piece'
      pieceId: string
      mirror: boolean
      reverse: boolean
      branch: PlanStep[] | null
      branchPortId: string | null
      /** Speksin oman askeleen indeksi; linkin päätepisteet viittaavat näihin. */
      source: number | null
    }

interface Walk {
  placed: PlacedPiece[]
  edges: [number, number][]
  /** Speksin askelindeksi -> palan indeksi `placed`-taulukossa. */
  sources: Map<number, number>
}

function isFill(step: VariationStep): step is VariationFillStep {
  return 'fill' in step
}

/** Täyttöaskeleet kulkujärjestyksessä: pääketju haaroineen, sitten linkki. */
function fillSlots(spec: VariationSpec): VariationFillSpec[] {
  const slots: VariationFillSpec[] = []
  const collect = (steps: readonly VariationStep[]): void => {
    for (const step of steps) {
      if (isFill(step)) {
        slots.push(step.fill)
        continue
      }
      if (step.branch) collect(step.branch.steps)
    }
  }
  collect(spec.steps)
  if (spec.link) collect(spec.link.steps)
  return slots
}

/** Pituusehdokkaat yhdelle täyttöaskeleelle, tasavälein koko sallitulta väliltä. */
function fillCandidates(table: FillTable, slot: VariationFillSpec): number[] {
  const min = slot.minMm ?? 0
  const max = slot.maxMm ?? Infinity
  const all = fillableLengths(table).filter((length) => length >= min - EPS_MM && length <= max + EPS_MM)
  if (all.length <= MAX_FILL_CANDIDATES) return all
  const picked: number[] = []
  for (let i = 0; i < MAX_FILL_CANDIDATES; i += 1) {
    picked.push(all[Math.round((i * (all.length - 1)) / (MAX_FILL_CANDIDATES - 1))])
  }
  return [...new Set(picked)]
}

/** Kaikki kokeiltavat pituusyhdistelmät; järjestys on vakaa, joten tulos on deterministinen. */
function fillCombos(table: FillTable, slots: readonly VariationFillSpec[]): number[][] {
  let combos: number[][] = [[]]
  for (const slot of slots) {
    const candidates = fillCandidates(table, slot)
    if (candidates.length === 0) return []
    const next: number[][] = []
    for (const combo of combos) {
      for (const length of candidates) {
        if (next.length >= MAX_COMBOS) break
        next.push([...combo, length])
      }
    }
    combos = next
  }
  return combos
}

/**
 * Suunnitelma, jossa täyttöaskeleet ovat vielä pelkkiä pituuksia. Vain kuvion
 * ylimmän tason askeleet numeroidaan: linkin päätepisteet viittaavat niihin, ja
 * numero säilyy myös kun täytöt puretaan paloiksi.
 */
function planGeometry(
  steps: readonly VariationStep[],
  lengths: readonly number[],
  cursor: { index: number },
  topLevel: boolean,
): PlanStep[] {
  return steps.map((step, index) => {
    if (isFill(step)) return { kind: 'advance' as const, lengthMm: lengths[cursor.index++] }
    return {
      kind: 'piece' as const,
      pieceId: step.piece,
      mirror: step.mirror ?? false,
      reverse: step.reverse ?? false,
      branch: step.branch ? planGeometry(step.branch.steps, lengths, cursor, false) : null,
      branchPortId: step.branch?.portId ?? null,
      source: topLevel ? index : null,
    }
  })
}

/** Sama suunnitelma, mutta täyttöaskeleet purettuina oikeiksi paloiksi. */
function planPieces(plan: readonly PlanStep[], library: PieceLibrary, ledger: Ledger, salt: number): PlanStep[] | null {
  const built: PlanStep[] = []
  for (const step of plan) {
    if (step.kind === 'advance') {
      const fill = solveFill(library, ledger, makeRng(FILL_SEED).fork(salt + built.length), { distanceMm: step.lengthMm })
      if (!fill) return null
      for (const pieceId of fill) {
        built.push({ kind: 'piece', pieceId, mirror: false, reverse: false, branch: null, branchPortId: null, source: null })
      }
      continue
    }
    if (!ledger.take(step.pieceId)) return null
    let branch: PlanStep[] | null = null
    if (step.branch) {
      branch = planPieces(step.branch, library, ledger, salt + 1)
      if (!branch) return null
    }
    built.push({ ...step, branch })
  }
  return built
}

function frameOfPort(port: Port): Frame {
  return { x: port.x, y: port.y, dir: port.dir, level: port.levelOffset, open: port.connector }
}

/**
 * Kulkee suunnitelman läpi annetusta kohdistimesta. Sivuhaara riippuu
 * palastaan muttei jatka pääketjua, ja umpipää päättää oman ketjunsa.
 */
function walkPlan(
  plan: readonly PlanStep[],
  library: PieceLibrary,
  start: Frame,
  acc: Walk,
  attachedTo: number,
): { exit: Frame; lastIndex: number } | null {
  let cursor = start
  let previous = attachedTo

  for (const [stepIndex, step] of plan.entries()) {
    if (step.kind === 'advance') {
      cursor = advance(cursor, step.lengthMm)
      continue
    }
    if (!library.has(step.pieceId)) return null
    const piece = library.get(step.pieceId)

    if (piece.isTerminal) {
      if (stepIndex !== plan.length - 1) return null
      const terminal = placeTerminal(piece, cursor, { mirror: step.mirror })
      if (!terminal) return null
      const index = acc.placed.push(terminal) - 1
      if (previous >= 0) acc.edges.push([previous, index])
      if (step.source !== null) acc.sources.set(step.source, index)
      return { exit: cursor, lastIndex: previous >= 0 ? previous : index }
    }

    const [first, second] = piece.mainPorts
    if (!first || !second) return null
    const result = placeAtFrame(piece, cursor, {
      mirror: step.mirror,
      entryPortId: step.reverse ? second.id : first.id,
      exitPortId: step.reverse ? first.id : second.id,
    })
    if (!result) return null

    const index = acc.placed.push(result.placed) - 1
    if (previous >= 0) acc.edges.push([previous, index])
    if (step.source !== null) acc.sources.set(step.source, index)

    if (step.branch) {
      const port = piece.ports.find((candidate) => candidate.id === step.branchPortId)
      if (!port) return null
      const world = transformPort(port, result.placed.placement)
      if (!walkPlan(step.branch, library, frameOfPort(world), acc, index)) return null
    }

    previous = index
    cursor = result.exit
  }

  return { exit: cursor, lastIndex: previous }
}

/** Kohdistin eteenpäin ilman palaa: täyttö on aina suoraa, joten suunta säilyy. */
function advance(frame: Frame, lengthMm: number): Frame {
  const radians = (frame.dir * Math.PI) / 4
  return { ...frame, x: frame.x + Math.cos(radians) * lengthMm, y: frame.y + Math.sin(radians) * lengthMm }
}

export interface VariationRun {
  placed: PlacedPiece[]
  edges: [number, number][]
  exit: Frame
  /** Pääketjun viimeinen pala: sivuraiteen puskuri on taulukossa myöhemmin. */
  exitIndex: number
  /** Umpisilmukan sulkeutumisjäännös, jonka Vario nielee. */
  linkGapMm: number
}

/** Kulkee kuvion läpi linkkeineen. Palauttaa null, jos jokin ei mene kiinni. */
function runVariation(
  spec: VariationSpec,
  plan: readonly PlanStep[],
  linkPlan: readonly PlanStep[] | null,
  library: PieceLibrary,
  start: Frame,
): VariationRun | null {
  const acc: Walk = { placed: [], edges: [], sources: new Map() }
  const main = walkPlan(plan, library, start, acc, -1)
  if (!main) return null
  if (!spec.link || !linkPlan) {
    return { placed: acc.placed, edges: acc.edges, exit: main.exit, exitIndex: main.lastIndex, linkGapMm: 0 }
  }

  const fromPort = worldPortOf(acc, library, spec.link.from.step, spec.link.from.portId)
  const toPort = worldPortOf(acc, library, spec.link.to.step, spec.link.to.portId)
  if (!fromPort || !toPort) return null

  const fromIndex = acc.sources.get(spec.link.from.step) as number
  const link = walkPlan(linkPlan, library, frameOfPort(fromPort.port), acc, fromIndex)
  if (!link) return null

  // Sivuraiteen on tultava takaisin porttiin: suunta, taso ja liittimen
  // sukupuoli täsmälleen, sijainnin heiton nielee Vario.
  const target = toPort.port
  if (link.exit.dir !== oppositeDir(target.dir)) return null
  if (link.exit.level !== target.levelOffset) return null
  if (link.exit.open !== complementOf(target.connector)) return null
  const linkGapMm = Math.hypot(link.exit.x - target.x, link.exit.y - target.y)
  if (linkGapMm > LINK_TOLERANCE_MM) return null

  acc.edges.push([link.lastIndex, toPort.index])
  return { placed: acc.placed, edges: acc.edges, exit: main.exit, exitIndex: main.lastIndex, linkGapMm }
}

function worldPortOf(
  acc: Walk,
  library: PieceLibrary,
  step: number,
  portId: string,
): { port: Port; index: number } | null {
  const index = acc.sources.get(step)
  if (index === undefined) return null
  const placed = acc.placed[index]
  const port = library.get(placed.pieceId).ports.find((candidate) => candidate.id === portId)
  if (!port) return null
  return { port: transformPort(port, placed.placement), index }
}

// --- Ratkaisu: mitkä kuviot mahtuvat osuudelle -------------------------------

export interface ResolvedVariation {
  spec: VariationSpec
  /** Ytimen etenemä osuuden suunnassa. */
  alongMm: number
  /** Sivutilan tarve kulkusuunnasta katsoen vasemmalla ja oikealla. */
  leftMm: number
  rightMm: number
  pieceCounts: Record<string, number>
  pieceCount: number
  /** Sivuraiteen sulkeutumisjäännös; osa päätyheittoa. */
  linkGapMm: number
  /** Ydin, jonka `insertIntoRun` upottaa osuudelle. */
  run: (cursor: Frame) => VariationRun | null
}

/**
 * Kuvion paras toteutus annetulle osuudelle, tai null jos se ei mahdu tai
 * kokoelmasta puuttuu paloja. Pituusyhdistelmiä on kymmeniä, joten geometria
 * ratkaistaan ensin ilman paloja ja vasta selvinneille etsitään oikeat palat.
 */
export function resolveVariation(
  spec: VariationSpec,
  library: PieceLibrary,
  table: FillTable,
  available: Inventory,
  maxAlongMm: number,
): ResolvedVariation | null {
  const slots = fillSlots(spec)
  const candidates: { lengths: number[]; alongMm: number; linkGapMm: number }[] = []

  for (const lengths of fillCombos(table, slots)) {
    const geometry = planFor(spec, lengths)
    const run = runVariation(spec, geometry.main, geometry.link, library, CANONICAL_START)
    if (!run) continue
    const through = throughOf(run.exit)
    if (!through || through.alongMm > maxAlongMm + EPS_MM) continue
    candidates.push({ lengths, alongMm: through.alongMm, linkGapMm: run.linkGapMm })
  }

  // Tiukin sulkeutuminen ensin; tasapelissä lyhyempi kuvio, koska se mahtuu
  // useammalle osuudelle.
  candidates.sort((a, b) => a.linkGapMm - b.linkGapMm || a.alongMm - b.alongMm)

  for (const candidate of candidates.slice(0, MAX_BUILDS)) {
    const built = buildPlan(spec, candidate.lengths, library, available)
    if (!built) continue
    const run = runVariation(spec, built.main, built.link, library, CANONICAL_START)
    if (!run) continue
    const through = throughOf(run.exit)
    if (!through) continue

    const extent = lateralExtent(run.placed, library)
    return {
      spec,
      alongMm: through.alongMm,
      leftMm: extent.leftMm,
      rightMm: extent.rightMm,
      pieceCounts: countOf(run.placed),
      pieceCount: run.placed.length,
      linkGapMm: run.linkGapMm,
      run: (cursor) => runVariation(spec, built.main, built.link, library, cursor),
    }
  }

  return null
}

function planFor(spec: VariationSpec, lengths: readonly number[]): { main: PlanStep[]; link: PlanStep[] | null } {
  const cursor = { index: 0 }
  return {
    main: planGeometry(spec.steps, lengths, cursor, true),
    link: spec.link ? planGeometry(spec.link.steps, lengths, cursor, false) : null,
  }
}

function buildPlan(
  spec: VariationSpec,
  lengths: readonly number[],
  library: PieceLibrary,
  available: Inventory,
): { main: PlanStep[]; link: PlanStep[] | null } | null {
  const geometry = planFor(spec, lengths)
  const ledger = new Ledger(available)
  const main = planPieces(geometry.main, library, ledger, 0)
  if (!main) return null
  if (!spec.link) return { main, link: null }
  const link = planPieces(geometry.link as PlanStep[], library, ledger, 1000)
  if (!link) return null
  return { main, link }
}

/** Onko ydin läpimenevä: sama suunta, sama taso, ei sivusiirtymää? */
function throughOf(exit: Frame): { alongMm: number } | null {
  if (exit.dir !== CANONICAL_START.dir || exit.level !== CANONICAL_START.level) return null
  if (exit.open !== CANONICAL_START.open) return null
  if (Math.abs(exit.y) > THROUGH_TOLERANCE_MM) return null
  if (exit.x <= 0) return null
  return { alongMm: exit.x }
}

/**
 * Kuinka kauas kuvio ulottuu osuuden keskilinjasta kumpaankin suuntaan.
 * Mitataan keskilinjoista, koska osuuden sivutilakin (`sectionBrief`) on
 * mitattu keskilinjasta keskilinjaan.
 */
function lateralExtent(pieces: readonly PlacedPiece[], library: PieceLibrary): { leftMm: number; rightMm: number } {
  let leftMm = 0
  let rightMm = 0
  for (const placed of pieces) {
    for (const point of samplePath(placedSegments(placed, library.get(placed.pieceId)), 20)) {
      if (point.y > rightMm) rightMm = point.y
      if (-point.y > leftMm) leftMm = -point.y
    }
  }
  return { leftMm, rightMm }
}

function countOf(pieces: readonly PlacedPiece[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const placed of pieces) counts[placed.pieceId] = (counts[placed.pieceId] ?? 0) + 1
  return counts
}
