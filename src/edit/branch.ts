import { fillableLengths, isFillable, nearestFillable, solveFill, type FillTable } from '../core/fill'
import { Ledger, type Inventory } from '../core/inventory'
import type { PieceLibrary } from '../core/library'
import { samplePath } from '../core/path'
import {
  entryFrame,
  exitFrame,
  placeAtFrame,
  placedSegments,
  type Frame,
  type PlacedPiece,
  type ResolvedPiece,
} from '../core/pieces'
import { transformPort, type Port } from '../core/ports'
import { makeRng } from '../core/rng'
import { CELL_MM, EPS_MM } from '../core/units'
import type { Vec } from '../core/vec'
import { fitOptions } from '../fit/beam'
import { availableExcluding, relaxSection, splice } from './replace'
import { isSoftPiece, naturalSection, neighbourLists, type Section, type TrackChain } from './section'

// Haarakohdan etsintä (README luku 5, "Haara mutkaan"). Kaksi tapaa liittää
// uusi ketju valmiiseen rataan:
//
// 1. **Suora on liukuva ankkurivyöhyke.** Vaihde voi asettua suoralle mihin
//    kohtaan tahansa, koska osuus täytetään uudelleen sen molemmin puolin.
//    Osuuden kokonaispituus ei muutu, joten muu rata ei liiku.
// 2. **Kaari on jäykkä piste.** Sitä ei voi siirtää, joten vaihtoehdot ovat
//    suora ennen mutkaa, suora mutkan jälkeen tai kaaren vaihto haaroittavaan
//    palaan. Vaihtokelpoisuus tulee porttisignatuurista, ei koodista: E1:n
//    tilalle kelpaa O/P, A:n tilalle L/M/I/J/T/X. Uusi haaroittava pala
//    palakirjastossa liittyy mukaan ilman että tähän tiedostoon kosketaan.
//
// Haarakohta ei koskaan riko rataa: epäonnistunut yritys palauttaa null ja
// alkuperäinen rata jää koskemattomaksi (CLAUDE.md).

/** Nappausetäisyys ~1 solu (README luku 5). */
export const BRANCH_SNAP_MM = CELL_MM

/**
 * Täytön arvonta on siemennetty vakiolla: lisäävä piirto on sovitusta, ja
 * sovitus on täysin deterministinen (docs/DRAWING.md). Sama veto tuottaa aina
 * saman haaran.
 */
const FILL_SEED = 0x5ea5ed

/** Porttien osumatoleranssi palaa vaihdettaessa; signatuurit pyöristetään kahteen desimaaliin. */
const SWAP_EPS_MM = 0.2

/** Näin monta lähintä palaa tutkitaan haarakohdan etsinnässä. */
const MAX_NEAR_PIECES = 4

/** Keskilinja näytteistetään tällä tiheydellä etäisyysmittausta varten. */
const SAMPLE_STEP_MM = 20

export interface RunCoreResult {
  placed: PlacedPiece[]
  exit: Frame
  /**
   * Ytimen omat liitokset `placed`-indekseinä. Oletus on peräkkäinen ketju;
   * sivuraiteellinen ydin (autosolverin variaatio) kertoo ne itse.
   */
  edges?: [number, number][]
  /** Ytimen pääketjun viimeinen pala; oletus on taulukon viimeinen. */
  exitIndex?: number
  /** Ytimen sisäinen sulkeutumisjäännös, esim. ohituskaiteen umpisilmukka. */
  gapMm?: number
}

/**
 * Osuudelle upotettava ydin: vaihde, risteys, silta tai kokonainen
 * variaatiokuvio. Ydin osaa sijoittaa itsensä mihin tahansa kohdistimeen, ja
 * täyttö hoitaa loput.
 */
export type RunCore = (cursor: Frame) => RunCoreResult | null

/** Suoralle osuudelle upotettu ydin: rata osuuden vaihdon jälkeen. */
export interface RunInsertion {
  pieces: PlacedPiece[]
  joints: [number, number][]
  /** Ytimen ensimmäisen palan indeksi `pieces`-taulukossa. */
  coreStart: number
  /** Osuuden omat liitokset päätyliitoksineen: päätyheitto kohdistuu näihin. */
  localJoints: [number, number][]
  /** Päätyheitto, jonka Vario nielee. */
  gapMm: number
  added: Record<string, number>
  removed: Record<string, number>
  /** Mihin kohtaan osuutta pala tuli, alusta mitattuna. */
  alongMm: number
}

/** Valmis haarakohta: rata haarapalan lisäämisen jälkeen ja avoin haaraportti. */
export interface BranchAnchor {
  kind: 'run' | 'swap'
  junctionId: string
  portId: string
  /** Avoin haaraportti — uusi ketju lähtee tästä. */
  frame: Frame
  pieces: PlacedPiece[]
  joints: [number, number][]
  /** Haarapalan indeksi `pieces`-taulukossa. */
  junctionIndex: number
  /** Osuuden vaihdosta jäänyt päätyheitto (swapissa aina 0). */
  gapMm: number
  localJoints: [number, number][]
  added: Record<string, number>
  removed: Record<string, number>
  /** Kuinka kauas osoitetusta pisteestä haara jäi. */
  offsetMm: number
  cost: number
}

export interface BranchOptions {
  /** Nappausetäisyys; tätä kauempaa ei haaroiteta. */
  snapMm?: number
  /** Montako haarakohtaa palautetaan sovitettavaksi. */
  limit?: number
}

/**
 * Haaroittavat palat: kaikki, joilla on haaraportti. Puhtaat risteykset (H, H1,
 * H2) jäävät pois — niiden "haara" on läpimenevä toinen raide, ei vaihde;
 * risteämän ratkaisu käyttää ne erikseen (crossing.ts).
 */
export function branchingPieces(library: PieceLibrary): ResolvedPiece[] {
  return library.pieces.filter(
    (piece) =>
      piece.ports.some((port) => port.branch) &&
      !piece.isTerminal &&
      !piece.tags.includes('unverified-geometry') &&
      (piece.tags.includes('switch') || !piece.tags.includes('crossing')),
  )
}

/**
 * Haarapalan järjestyskustannus. Perusvaihde on luonteva haara, risteys muuttaa
 * radan luonnetta ja harvinainen pala on harvinainen — kustannus johdetaan
 * tageista, joten uusi pala saa sen datasta ilman koodimuutosta.
 */
function junctionCost(piece: ResolvedPiece): number {
  let cost = piece.tags.includes('basic') ? 0 : 60
  if (piece.tags.includes('tee') || piece.tags.includes('star') || piece.tags.includes('crossing')) cost += 200
  if (piece.tags.includes('rare') || piece.tags.includes('retired')) cost += 150
  return cost
}

function countOf(ids: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const id of ids) counts[id] = (counts[id] ?? 0) + 1
  return counts
}

/** Osuuden nimellispituus: palojen keskilinjojen summa, ei venytettyä geometriaa. */
function nominalLength(track: TrackChain, library: PieceLibrary, indices: readonly number[]): number {
  return indices.reduce((sum, index) => sum + library.get(track.pieces[index].pieceId).lengthMm, 0)
}

/** Molemmat kulkusuunnat palan läpi: sukupuolitettu liitin kelpuuttaa vain toisen. */
function portOrders(piece: ResolvedPiece): { entryPortId: string; exitPortId: string }[] {
  const [a, b] = piece.mainPorts
  if (!a || !b) return []
  return [
    { entryPortId: a.id, exitPortId: b.id },
    { entryPortId: b.id, exitPortId: a.id },
  ]
}

/**
 * Lähin täytettävissä oleva kohta osuudella. Vaihde liukuu suoralla vapaasti,
 * mutta vain palarajoihin: sekä sitä edeltävän että sitä seuraavan välin on
 * oltava täytettävissä.
 */
function chooseOffset(
  table: FillTable,
  slackMm: number,
  targetMm: number,
  range?: { minMm: number; maxMm: number },
): number | null {
  const lowMm = Math.max(0, range?.minMm ?? 0)
  const highMm = Math.min(slackMm, range?.maxMm ?? slackMm)
  if (lowMm > highMm + EPS_MM) return null
  const wanted = Math.max(lowMm, Math.min(highMm, targetMm))

  let best: number | null = null
  let bestDelta = Infinity
  for (const lengthMm of fillableLengths(table)) {
    if (lengthMm > highMm + EPS_MM) break
    if (lengthMm < lowMm - EPS_MM) continue
    if (!isFillable(table, slackMm - lengthMm)) continue
    const delta = Math.abs(lengthMm - wanted)
    if (delta < bestDelta - EPS_MM) {
      best = lengthMm
      bestDelta = delta
    }
  }
  return best
}

export interface RunInsertOptions {
  /** Mihin väliin ytimen ankkuri saa asettua osuudella. */
  range?: { minMm: number; maxMm: number }
  /**
   * Saako täyttö jäädä vajaaksi? Suorista koottu ydin osuu mikrogridiin ja
   * täyttyy eksaktisti, mutta kaarista koottu ei (45° → √2). Silloin täyttö
   * napsautetaan lähimpään täytettävään pituuteen ja jäännös jää Varion
   * nieltäväksi — sama toleranssibudjetti kuin silmukan saumassa.
   */
  snapFill?: boolean
}

/**
 * Upottaa palan suoralle osuudelle annettuun kohtaan ja täyttää sen molemmin
 * puolin. Osuuden pituus säilyy, joten muu rata ei liiku — juuri tämä tekee
 * suorasta liukuvan ankkurivyöhykkeen.
 */
export function insertIntoRun(
  track: TrackChain,
  library: PieceLibrary,
  table: FillTable,
  inventory: Inventory,
  section: Section,
  core: RunCore,
  targetAlongMm: number,
  options: RunInsertOptions = {},
): RunInsertion | null {
  if (!section.replaceable) return null
  const runMm = nominalLength(track, library, section.indices)

  const probe = core(section.start)
  // Osuus on suora: ytimen on jatkettava samaan suuntaan samalla tasolla,
  // muuten se ei ole tämän osuuden korvaaja vaan uusi muoto.
  if (!probe || probe.exit.dir !== section.start.dir || probe.exit.level !== section.start.level) return null

  const throughMm = Math.hypot(probe.exit.x - section.start.x, probe.exit.y - section.start.y)
  const rawSlackMm = runMm - throughMm
  if (rawSlackMm < -EPS_MM) return null

  // Napsautettu täyttö jää vajaaksi tai menee yli; erotus näkyy suoraan
  // päätyheittona, koska ketjun loppukohdistin lasketaan joka tapauksessa
  // geometriasta.
  const slackMm = options.snapFill ? nearestFillable(table, rawSlackMm) : rawSlackMm
  if (slackMm === null) return null

  // Ydin liukuu osuudella, mutta sen sijainti mitataan sen omasta ankkurista:
  // risteyspalan on osuttava kohtaan, jossa piirretty viiva ylittää radan.
  const alongMm = chooseOffset(table, slackMm, targetAlongMm, options.range)
  if (alongMm === null) return null

  const available = availableExcluding(track, new Set(section.indices), inventory)
  return buildRun(track, library, available, section, core, probe, alongMm, slackMm - alongMm)
}

function buildRun(
  track: TrackChain,
  library: PieceLibrary,
  available: Inventory,
  section: Section,
  core: RunCore,
  probe: RunCoreResult,
  headMm: number,
  tailMm: number,
): RunInsertion | null {
  // Ydin varataan ennen täyttöjä: se on aina se harvinaisempi pala, ja täytön
  // saa yleensä koottua siitä mitä jää jäljelle.
  const ledger = new Ledger(available)
  for (const placed of probe.placed) {
    if (!ledger.take(placed.pieceId)) return null
  }
  const rng = makeRng(FILL_SEED)
  const head = solveFill(library, ledger, rng, { distanceMm: headMm })
  if (!head) return null
  const tail = solveFill(library, ledger, rng, { distanceMm: tailMm })
  if (!tail) return null

  const replacement: PlacedPiece[] = []
  const edges: [number, number][] = []
  let cursor = section.start
  /** Ketjun viimeisin pala: seuraava liittyy tähän, ei taulukon loppuun. */
  let previous = -1

  const append = (pieceId: string): boolean => {
    const result = placeAtFrame(library.get(pieceId), cursor)
    if (!result) return false
    const index = replacement.push(result.placed) - 1
    if (previous >= 0) edges.push([previous, index])
    previous = index
    cursor = result.exit
    return true
  }

  for (const id of head) if (!append(id)) return null

  const placedCore = core(cursor)
  if (!placedCore) return null
  const coreStart = replacement.length
  if (placedCore.placed.length > 0) {
    replacement.push(...placedCore.placed)
    for (const [a, b] of placedCore.edges ?? consecutive(placedCore.placed.length)) {
      edges.push([coreStart + a, coreStart + b])
    }
    if (previous >= 0) edges.push([previous, coreStart])
    // Sivuraiteen puskuri on taulukossa viimeisenä muttei ketjussa: ketju
    // jatkuu ytimen pääreitin päästä.
    previous = coreStart + (placedCore.exitIndex ?? placedCore.placed.length - 1)
    cursor = placedCore.exit
  }

  for (const id of tail) if (!append(id)) return null
  if (replacement.length === 0) return null

  // Osuuden on päädyttävä samaan porttiin kuin ennenkin — suunta, taso ja
  // liittimen sukupuoli täsmälleen, sijainnin heiton nielee Vario.
  if (cursor.dir !== section.end.dir || cursor.level !== section.end.level || cursor.open !== section.end.open) return null

  const gap: Vec = { x: cursor.x - section.end.x, y: cursor.y - section.end.y }
  const gapMm = Math.hypot(gap.x, gap.y) + (placedCore.gapMm ?? 0)
  relaxSection(replacement, gap)

  const spliced = splice(track, section, replacement, { edges, entry: 0, exit: previous })
  const first = track.pieces.length - section.indices.length

  return {
    pieces: spliced.pieces,
    joints: spliced.joints,
    localJoints: spliced.localJoints,
    coreStart: first + coreStart,
    gapMm,
    added: countOf(replacement.map((placed) => placed.pieceId)),
    removed: countOf(section.indices.map((i) => track.pieces[i].pieceId)),
    alongMm: headMm,
  }
}

function consecutive(count: number): [number, number][] {
  const edges: [number, number][] = []
  for (let i = 1; i < count; i += 1) edges.push([i - 1, i])
  return edges
}

/** Yhden palan ydin: sijoitus annetussa kulkusuunnassa. */
export function pieceCore(
  library: PieceLibrary,
  pieceId: string,
  order: { entryPortId: string; exitPortId: string },
  mirror = false,
): RunCore {
  return (cursor) => {
    const result = placeAtFrame(library.get(pieceId), cursor, { ...order, mirror })
    return result ? { placed: [result.placed], exit: result.exit } : null
  }
}

/** Palan haaraportit maailmakoordinaatistossa. */
export function branchPortsOf(placed: PlacedPiece, piece: ResolvedPiece): Port[] {
  return piece.ports.filter((port) => port.branch).map((port) => transformPort(port, placed.placement))
}

/**
 * Voiko haaraporttiin ylipäätään liittää mitään? Osa vaihteista (J, P, G) on
 * sama pala liitinsukupuolet päinvastoin, ja niiden haaraportti on kolo — sitä
 * vasten sovituksen palavalikoimasta ei löydy yhtään palaa. Kysymys esitetään
 * suoraan sovitukselle, jottei tähän jää omaa kopiota säännöstä.
 */
function canAttach(library: PieceLibrary, frame: Frame): boolean {
  return fitOptions(library).some((option) => placeAtFrame(option.piece, frame, { mirror: option.mirror }) !== null)
}

/** Avoin kehys portista: uusi ketju lähtee tästä ulospäin. */
function frameOfPort(port: Port): Frame {
  return { x: port.x, y: port.y, dir: port.dir, level: port.levelOffset, open: port.connector }
}

interface NearHit {
  index: number
  distanceMm: number
  point: Vec
}

/** Lähimmät palat osoitettuun pisteeseen; nappausetäisyyden ulkopuoliset karsitaan. */
function nearestPieces(track: TrackChain, library: PieceLibrary, point: Vec, snapMm: number): NearHit[] {
  const hits: NearHit[] = []
  track.pieces.forEach((placed, index) => {
    const piece = library.get(placed.pieceId)
    let best = Infinity
    let bestPoint = point
    for (const sample of samplePath(placedSegments(placed, piece), SAMPLE_STEP_MM)) {
      const distance = Math.hypot(sample.x - point.x, sample.y - point.y)
      if (distance < best) {
        best = distance
        bestPoint = sample
      }
    }
    if (best <= snapMm) hits.push({ index, distanceMm: best, point: bestPoint })
  })
  return hits.sort((a, b) => a.distanceMm - b.distanceMm).slice(0, MAX_NEAR_PIECES)
}

/** Etenemä osuuden alusta annettuun pisteeseen; osuus on suora, joten projektio riittää. */
function alongSection(section: Section, point: Vec): number {
  const dx = section.end.x - section.start.x
  const dy = section.end.y - section.start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return 0
  const t = ((point.x - section.start.x) * dx + (point.y - section.start.y) * dy) / lengthSq
  return Math.max(0, Math.min(1, t)) * Math.sqrt(lengthSq)
}

/**
 * Haarakohdat osoitetun pisteen ympäriltä, parhaat ensin. Palauttaa tyhjän
 * listan, jos piste ei ole radan lähellä tai jos haarapalaa ei saada mahtumaan
 * — kutsuja kertoo syyn käyttäjälle sen sijaan että arvaisi haaran paikan.
 */
export function branchAnchors(
  track: TrackChain,
  library: PieceLibrary,
  table: FillTable,
  inventory: Inventory,
  point: Vec,
  options: BranchOptions = {},
): BranchAnchor[] {
  const snapMm = options.snapMm ?? BRANCH_SNAP_MM
  const candidates = branchingPieces(library)
  const neighbours = neighbourLists(track)
  const anchors: BranchAnchor[] = []
  const runsDone = new Set<string>()

  const addRun = (section: Section | null, targetPoint: Vec): void => {
    if (!section) return
    const key = section.indices.join(',')
    if (runsDone.has(key)) return
    runsDone.add(key)
    const targetAlongMm = alongSection(section, targetPoint)
    for (const piece of candidates) {
      for (const order of portOrders(piece)) {
        const core = pieceCore(library, piece.id, order)
        const inserted = insertIntoRun(track, library, table, inventory, section, core, targetAlongMm)
        if (!inserted) continue
        anchors.push(...anchorsFrom('run', library, inserted.pieces, inserted, piece, point))
        // Sukupuolitettu liitin kelpuuttaa vain toisen kulkusuunnan; jos
        // molemmat kelpaavat, ne ovat sama pala samassa paikassa.
        break
      }
    }
  }

  for (const hit of nearestPieces(track, library, point, snapMm)) {
    const placed = track.pieces[hit.index]
    const piece = library.get(placed.pieceId)

    if (isSoftPiece(piece)) {
      addRun(naturalSection(track, library, hit.index), hit.point)
      continue
    }

    // Kaari on jäykkä piste: vaihdetaan se haaroittavaan palaan, tai
    // haaroitetaan sitä ympäröiviltä suorilta (README luku 5).
    anchors.push(...swapAnchors(track, library, inventory, hit.index, point))
    for (const other of neighbours[hit.index]) {
      if (!isSoftPiece(library.get(track.pieces[other].pieceId))) continue
      addRun(naturalSection(track, library, other), hit.point)
    }
  }

  const seen = new Set<string>()
  return anchors
    .sort((a, b) => a.cost - b.cost || a.junctionId.localeCompare(b.junctionId))
    .filter((anchor) => {
      const key = `${anchor.kind}|${anchor.junctionId}|${anchor.portId}|${anchor.frame.x.toFixed(0)},${anchor.frame.y.toFixed(0)},${anchor.frame.dir}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, options.limit ?? 8)
}

/** Yhden sijoituksen haaraportit omiksi haarakohdikseen. */
function anchorsFrom(
  kind: BranchAnchor['kind'],
  library: PieceLibrary,
  pieces: PlacedPiece[],
  inserted: Omit<RunInsertion, 'pieces'>,
  piece: ResolvedPiece,
  point: Vec,
): BranchAnchor[] {
  return branchPortsOf(pieces[inserted.coreStart], piece)
    .map((port) => ({ port, frame: frameOfPort(port) }))
    .filter(({ frame }) => canAttach(library, frame))
    .map(({ port, frame }) => {
      const offsetMm = Math.hypot(port.x - point.x, port.y - point.y)
      return {
        kind,
        junctionId: piece.id,
        portId: port.id,
        frame,
        pieces,
        joints: inserted.joints,
        junctionIndex: inserted.coreStart,
        gapMm: inserted.gapMm,
        localJoints: inserted.localJoints,
        added: inserted.added,
        removed: inserted.removed,
        offsetMm,
        cost: offsetMm + junctionCost(piece),
      }
    })
}

/**
 * Kaaren vaihto haaroittavaan palaan. Vaihtokelpoiset palat tulevat
 * porttisignatuurista, ja oikea asento etsitään kokeilemalla: sen on vietävä
 * täsmälleen samaan päätyporttiin kuin vaihdettava pala.
 */
export function swapAnchors(
  track: TrackChain,
  library: PieceLibrary,
  inventory: Inventory,
  index: number,
  point: Vec,
): BranchAnchor[] {
  const placed = track.pieces[index]
  const original = library.get(placed.pieceId)
  const entry = entryFrame(placed, original)
  const exit = exitFrame(placed, original)
  const available = availableExcluding(track, new Set([index]), inventory)
  const anchors: BranchAnchor[] = []

  for (const piece of library.substitutesFor(original.id)) {
    if (!piece.ports.some((port) => port.branch)) continue
    if (piece.tags.includes('unverified-geometry')) continue
    if (!available.unlimited && (available.counts[piece.id] ?? 0) < 1) continue

    const swapped = swapPlacement(piece, entry, exit)
    if (!swapped) continue

    const pieces = [...track.pieces]
    pieces[index] = swapped
    anchors.push(
      ...anchorsFrom(
        'swap',
        library,
        pieces,
        {
          joints: track.joints.map(([a, b]) => [a, b] as [number, number]),
          coreStart: index,
          localJoints: [],
          gapMm: 0,
          added: { [piece.id]: 1 },
          removed: { [original.id]: 1 },
          alongMm: 0,
        },
        piece,
        point,
      ),
    )
  }
  return anchors
}

/** Sijoitus, joka alkaa samasta kehyksestä ja päätyy samaan päätyporttiin. */
export function swapPlacement(piece: ResolvedPiece, entry: Frame, exit: Frame): PlacedPiece | null {
  const mirrors = piece.mirrorable ? [false, true] : [false]
  for (const order of portOrders(piece)) {
    for (const mirror of mirrors) {
      const result = placeAtFrame(piece, entry, { ...order, mirror })
      if (!result) continue
      const { exit: landed } = result
      if (landed.dir !== exit.dir || landed.level !== exit.level || landed.open !== exit.open) continue
      if (Math.abs(landed.x - exit.x) > SWAP_EPS_MM || Math.abs(landed.y - exit.y) > SWAP_EPS_MM) continue
      return result.placed
    }
  }
  return null
}
