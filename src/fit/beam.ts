import { normalizeDir, snapDegreesToDir, type Dir } from '../core/dir'
import type { Inventory } from '../core/inventory'
import type { PieceLibrary } from '../core/library'
import { samplePath, segmentEnd } from '../core/path'
import {
  placeAtFrame,
  placedSegments,
  startFrame,
  type Frame,
  type PlacedPiece,
  type ResolvedPiece,
} from '../core/pieces'
import type { TargetPath } from './target'

// Sovitus keilahaulla (README luku 5 kohta 2): nykyisestä asemasta kokeillaan
// jokaista palaa, mitataan poikkeama piirretystä viivasta ja pidetään ~10
// parasta ketjua. Haarautumiskerroin on palojen määrä (~14), joten haku pysyy
// reaaliaikaisena myös puhelimella.
//
// Haku on tarkoituksella täysin deterministinen: satunnaisuutta ei käytetä
// lainkaan, joten sama veto tuottaa aina saman radan.

export interface FitOption {
  piece: ResolvedPiece
  mirror: boolean
  /**
   * Palan käyttökustannus. Taipuvalle palalle korkea, jottei sitä tuhlata
   * keskelle rataa (README luku 5) — kustannus johdetaan tageista, joten uusi
   * custom-pala saa sen automaattisesti ilman koodimuutosta.
   */
  useCost: number
}

export interface FitTuning {
  /** Montako ketjua pidetään elossa. */
  beamWidth: number
  maxPieces: number
  /** Käytävän puolileveys: tätä kauemmas piirretystä viivasta ei ajauduta. */
  corridorMm: number
  /** Poikkeaman hinta: yksi kustannusyksikkö per mm poikkeamaa per 100 mm palaa. */
  deviationWeight: number
  /** Liitoksen hinta: pitkiä paloja suositaan, koska joka liitos kuluttaa Variota. */
  jointCost: number
  /** Siksak-sakko: suunnanvaihdosta sakotetaan (README luku 5). */
  zigzagPenalty: number
  /** Jäljellä olevan matkan arvio, jotta eri pitkälle ehtineet ketjut vertautuvat. */
  remainingCostPerMm: number
  /** Palan on edettävä vähintään tämän verran, muuten ketju jää polkemaan paikallaan. */
  minAdvanceMm: number
  /** Näin lähellä loppua ketju katsotaan valmiiksi. */
  endToleranceMm: number
  /**
   * Montako valmista ketjua palautetaan jatkoarviointiin. Silmukan sauma
   * ratkeaa vasta täällä, ja keilan kärki on täynnä lähes identtisiä ketjuja,
   * joten muutama ylimääräinen ehdokas löysää saumaa selvästi — ilman että
   * haku itse hidastuu.
   */
  resultLimit: number
}

export const DEFAULT_TUNING: FitTuning = {
  beamWidth: 10,
  maxPieces: 120,
  corridorMm: 90,
  deviationWeight: 1,
  jointCost: 25,
  zigzagPenalty: 90,
  remainingCostPerMm: 0.5,
  minAdvanceMm: 8,
  endToleranceMm: 40,
  resultLimit: 16,
}

/** Näin pitkälle päässyt ketju kelpaa, vaikkei se yltäisi loppuun asti. */
const PARTIAL_ACCEPT_RATIO = 0.85

const FLEX_USE_COST = 2000
const UNCOMMON_USE_COST = 150
/** Poikkeama mitataan tällä tiheydellä palan keskilinjaa pitkin. */
const SAMPLE_STEP_MM = 20

function useCostFor(piece: ResolvedPiece): number {
  if (piece.tags.includes('flex')) return FLEX_USE_COST
  if (piece.tags.includes('rare') || piece.tags.includes('retired')) return UNCOMMON_USE_COST
  return 0
}

/**
 * Sovituksen palavalikoima: suorat ja kaaret molempiin käsiin. Vaihteet ja
 * risteykset jäävät pois — tyhjästä piirretty rata on yksi ketju, ja haarat
 * tulevat lisäävänä piirtona myöhemmässä vaiheessa.
 */
export function fitOptions(library: PieceLibrary): FitOption[] {
  const options: FitOption[] = []
  for (const piece of library.fillerStraights()) {
    options.push({ piece, mirror: false, useCost: useCostFor(piece) })
  }
  for (const piece of library.pieces) {
    if (piece.kind !== 'curve') continue
    const useCost = useCostFor(piece)
    options.push({ piece, mirror: false, useCost })
    if (piece.mirrorable) options.push({ piece, mirror: true, useCost })
  }
  // Vakaa järjestys pitää tasapelien ratkaisun deterministisenä.
  return options.sort((a, b) => a.piece.id.localeCompare(b.piece.id) || Number(a.mirror) - Number(b.mirror))
}

interface Node {
  parent: Node | null
  placed: PlacedPiece | null
  frame: Frame
  cost: number
  alongMm: number
  count: number
  /** Edellisen palan kääntymissuunta lokeroina; 0 = suora. */
  turn: number
  used: ReadonlyMap<string, number>
  /** Poikkeamien pituuspainotettu summa ja sitä vastaava matka. */
  deviationSumMm: number
  deviationLengthMm: number
  maxDeviationMm: number
}

export interface BeamFit {
  start: Frame
  end: Frame
  pieces: PlacedPiece[]
  usage: Record<string, number>
  deviation: { meanMm: number; maxMm: number }
  cost: number
}

export interface BeamOptions {
  library: PieceLibrary
  inventory: Inventory
  tuning?: Partial<FitTuning>
  allowConnectorFlip?: boolean
}

/** Kääntymä lokeroina välillä -3..4; etumerkki kertoo puolen. */
function signedTurn(from: Dir, to: Dir): number {
  const slots = normalizeDir(to - from)
  return slots > 4 ? slots - 8 : slots
}

function stockOf(inventory: Inventory, pieceId: string): number {
  return inventory.unlimited ? Infinity : inventory.counts[pieceId] ?? 0
}

/**
 * Sovittaa piirretyn viivan paloiksi. Palauttaa parhaat valmiit ketjut
 * kustannusjärjestyksessä; sulkeutumisen ja törmäysten arviointi jää
 * kutsujalle, jolla on Vario-asetukset.
 */
export function beamFit(target: TargetPath, options: BeamOptions): BeamFit[] {
  const tuning = { ...DEFAULT_TUNING, ...options.tuning }
  const candidates = fitOptions(options.library).filter((option) => stockOf(options.inventory, option.piece.id) > 0)
  if (candidates.length === 0) return []

  const beam = startNodes(target)
  const finished: Node[] = []
  const rank = (node: Node): number => node.cost + Math.max(0, target.lengthMm - node.alongMm) * tuning.remainingCostPerMm

  let live = beam
  for (let step = 0; step < tuning.maxPieces && live.length > 0; step += 1) {
    const children: Node[] = []
    for (const node of live) {
      for (const option of candidates) {
        const child = expand(node, option, target, tuning, options)
        if (!child) continue
        if (child.alongMm >= target.lengthMm - tuning.endToleranceMm) finished.push(child)
        else children.push(child)
      }
    }
    // Array.prototype.sort on vakaa, ja lapset syntyvät deterministisessä
    // järjestyksessä, joten tasapelit ratkeavat aina samalla tavalla.
    children.sort((a, b) => rank(a) - rank(b))
    live = children.slice(0, tuning.beamWidth)
  }

  // Loppuun jäävä matka maksaa, muuten ketju kannattaisi aina lopettaa heti
  // toleranssin sisällä ja viimeinen pala jäisi lyhyeksi.
  const complete = finished.length > 0 ? finished : live.filter((node) => node.alongMm >= target.lengthMm * PARTIAL_ACCEPT_RATIO)
  complete.sort((a, b) => rank(a) - rank(b))
  return complete.slice(0, tuning.resultLimit).map(toFit)
}

/**
 * Aloituskehykset. Piirron alkusuunta ei osu 45°-lokeroon, joten lähimmän
 * lisäksi kokeillaan molempia naapureita — pelkkä pyöristys voi olla 22,5°
 * pielessä, mikä näkyy heti ensimmäisessä mutkassa.
 */
function startNodes(target: TargetPath): Node[] {
  const headingDeg = target.headingDegAt(0, 80)
  const nearest = snapDegreesToDir(headingDeg).dir
  const dirs: Dir[] = [nearest, normalizeDir(nearest + 1), normalizeDir(nearest - 1)]
  const origin = target.pointAt(0)

  return dirs.map((dir) => ({
    parent: null,
    placed: null,
    frame: startFrame(origin.x, origin.y, dir, 0, 'pin'),
    // Väärä aloitussuunta maksaa hieman, jotta lähin lokero voittaa tasapelissä.
    cost: dir === nearest ? 0 : 60,
    alongMm: 0,
    count: 0,
    turn: 0,
    used: new Map<string, number>(),
    deviationSumMm: 0,
    deviationLengthMm: 0,
    maxDeviationMm: 0,
  }))
}

function expand(node: Node, option: FitOption, target: TargetPath, tuning: FitTuning, options: BeamOptions): Node | null {
  const { piece } = option
  const usedCount = node.used.get(piece.id) ?? 0
  if (usedCount >= stockOf(options.inventory, piece.id)) return null

  const result = placeAtFrame(piece, node.frame, {
    mirror: option.mirror,
    allowConnectorFlip: options.allowConnectorFlip,
  })
  if (!result) return null

  const segments = placedSegments(result.placed, piece)
  const samples = samplePath(segments, SAMPLE_STEP_MM)
  if (samples.length === 0) return null

  // Ikkuna kattaa palan mitan väljästi: tätä pidemmälle ei saa hypätä, vaikka
  // viiva palaisi lähelle itseään.
  const windowMm = piece.lengthMm * 1.5 + 80
  let deviationSum = 0
  let maxDeviation = 0
  for (const sample of samples) {
    const projection = target.project(sample, node.alongMm - SAMPLE_STEP_MM, windowMm)
    deviationSum += projection.distanceMm
    if (projection.distanceMm > maxDeviation) maxDeviation = projection.distanceMm
  }
  if (maxDeviation > tuning.corridorMm) return null

  const endPoint = segmentEnd(segments[segments.length - 1])
  const advanceMm = target.project(endPoint, node.alongMm, windowMm).alongMm - node.alongMm
  if (advanceMm < tuning.minAdvanceMm) return null

  const meanDeviationMm = deviationSum / samples.length
  const turn = signedTurn(node.frame.dir, result.exit.dir)
  const zigzag = turn !== 0 && node.turn !== 0 && Math.sign(turn) !== Math.sign(node.turn) ? tuning.zigzagPenalty : 0

  const used = new Map(node.used)
  used.set(piece.id, usedCount + 1)

  return {
    parent: node,
    placed: result.placed,
    frame: result.exit,
    cost:
      node.cost +
      (meanDeviationMm * piece.lengthMm * tuning.deviationWeight) / 100 +
      tuning.jointCost +
      option.useCost +
      zigzag,
    alongMm: node.alongMm + advanceMm,
    count: node.count + 1,
    turn,
    used,
    deviationSumMm: node.deviationSumMm + meanDeviationMm * piece.lengthMm,
    deviationLengthMm: node.deviationLengthMm + piece.lengthMm,
    maxDeviationMm: Math.max(node.maxDeviationMm, maxDeviation),
  }
}

function toFit(node: Node): BeamFit {
  const pieces: PlacedPiece[] = []
  // Vain aloitussolmulla ei ole palaa, joten ketju puretaan juureen asti.
  let current: Node = node
  while (current.placed && current.parent) {
    pieces.push(current.placed)
    current = current.parent
  }
  const root = current
  pieces.reverse()

  const usage: Record<string, number> = {}
  for (const [id, count] of node.used) usage[id] = count

  return {
    start: root.frame,
    end: node.frame,
    pieces,
    usage,
    deviation: {
      meanMm: node.deviationLengthMm > 0 ? node.deviationSumMm / node.deviationLengthMm : 0,
      maxMm: node.maxDeviationMm,
    },
    cost: node.cost,
  }
}
