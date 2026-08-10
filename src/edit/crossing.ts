import { oppositeDir, type Dir } from '../core/dir'
import type { FillTable } from '../core/fill'
import { Ledger, type Inventory } from '../core/inventory'
import type { PieceLibrary } from '../core/library'
import { samplePath } from '../core/path'
import {
  entryFrame,
  exitFrame,
  placedSegments,
  type Frame,
  type PlacedPiece,
  type ResolvedPiece,
} from '../core/pieces'
import { complementOf, type Connector, type Port } from '../core/ports'
import { TRACK_WIDTH_MM } from '../core/units'
import type { Vec } from '../core/vec'
import { traverseElement, type ElementLibrary } from '../gen/elements'
import { branchPortsOf, insertIntoRun, pieceCore, type RunCore } from './branch'
import { isSoftPiece, naturalSection, type Section, type TrackChain } from './section'

// Risteämän ratkaisu (README luku 6: "risteämän X/silta-valinta"). Lisäävä
// piirto voi viedä uuden haaran vanhan radan yli, ja siihen on kaksi
// rehellistä vastausta:
//
// - **Tasoristeys**: risteyspala (H/H1/H2/X) upotetaan vanhalle suoralle
//   osuudelle siihen kohtaan, jossa viiva ylittää radan, ja uusi ketju
//   sovitetaan sen läpimenevään haaraan kahtena jaksona.
// - **Silta**: uusi ketju nostetaan yli mäkielementillä (ramppi–kansi–ramppi).
//   Kansi on tasolla 1, joten se ei törmää alittavaan rataan; rampit ovat
//   lattialla, joten ne eivät saa osua siihen.
//
// Kumpikin on vaihtoehto, ei automaatti: valinta esitetään haamuesikatseluina
// kartalla (README luku 6, "yhtenäinen kuvio").

/** Risteämäksi lasketaan vasta tätä lähempi ohitus; sama kynnys kuin törmäyslaskurilla. */
const CONTACT_MM = TRACK_WIDTH_MM * 0.9

/** Tätä lähemmät kosketuskohdat ovat samaa risteämää. */
const CLUSTER_MM = TRACK_WIDTH_MM * 4

/** Keskilinjojen näytteistys risteämän paikannuksessa. */
const SAMPLE_STEP_MM = 12

/** Kannen alle jäävä pelivara: rampit ovat lattialla eivätkä saa osua alittavaan rataan. */
const DECK_MARGIN_MM = TRACK_WIDTH_MM

export interface CrossingSite {
  /** Uuden ketjun palan indeksi ketjun omassa indeksoinnissa. */
  chainIndex: number
  /** Vanhan radan palan indeksi. */
  baseIndex: number
  /** Kohta, jossa radat kohtaavat. */
  point: Vec
  /** Uuden ketjun kulkusuunta risteämässä. */
  heading: Dir
}

/**
 * Missä uusi ketju osuu vanhaan rataan. Vierekkäiset kosketukset niputetaan
 * yhdeksi risteämäksi: yksi ylitys koskettaa tyypillisesti kahta palaa.
 */
export function findCrossings(
  base: readonly PlacedPiece[],
  chain: readonly PlacedPiece[],
  library: PieceLibrary,
  joined: readonly [number, number][] = [],
): CrossingSite[] {
  // Liitoksessa kiinni olevat palat koskettavat toisiaan määritelmän mukaan:
  // haaran ensimmäinen pala lähtee vaihteen portista, ei sen yli.
  const connected = new Set(joined.map(([baseIndex, chainIndex]) => `${baseIndex},${chainIndex}`))
  const baseSamples = base.map((placed) => samplePath(placedSegments(placed, library.get(placed.pieceId)), SAMPLE_STEP_MM))
  const contacts: CrossingSite[] = []

  chain.forEach((placed, chainIndex) => {
    const piece = library.get(placed.pieceId)
    const samples = samplePath(placedSegments(placed, piece), SAMPLE_STEP_MM)
    const low = placed.placement.level
    const high = low + piece.levelDelta

    base.forEach((other, baseIndex) => {
      if (connected.has(`${baseIndex},${chainIndex}`)) return
      const otherPiece = library.get(other.pieceId)
      const otherLow = other.placement.level
      const otherHigh = otherLow + otherPiece.levelDelta
      // Eri tasolla kulkeva rata ei risteä vaan alittaa (README luku 4).
      if (low > otherHigh || otherLow > high) return

      let best = Infinity
      let point: Vec = samples[0] ?? { x: placed.placement.x, y: placed.placement.y }
      for (const a of samples) {
        for (const b of baseSamples[baseIndex]) {
          const distance = Math.hypot(a.x - b.x, a.y - b.y)
          if (distance < best) {
            best = distance
            point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          }
        }
      }
      if (best >= CONTACT_MM) return
      contacts.push({ chainIndex, baseIndex, point, heading: exitFrame(placed, piece).dir })
    })
  })

  const sites: CrossingSite[] = []
  for (const contact of contacts) {
    const merged = sites.some((site) => Math.hypot(site.point.x - contact.point.x, site.point.y - contact.point.y) <= CLUSTER_MM)
    if (!merged) sites.push(contact)
  }
  return sites
}

/** Risteyspalat: läpimenevä suora ja sen poikki kulkeva toinen raide. */
export function crossingPieces(library: PieceLibrary): ResolvedPiece[] {
  return library.pieces.filter(
    (piece) =>
      (piece.tags.includes('crossing') || piece.tags.includes('star')) &&
      !piece.tags.includes('unverified-geometry') &&
      piece.ports.some((port) => port.branch),
  )
}

export interface LevelCrossing {
  crossingId: string
  /** Vanha rata risteyspalan upottamisen jälkeen. */
  pieces: PlacedPiece[]
  joints: [number, number][]
  crossingIndex: number
  localJoints: [number, number][]
  gapMm: number
  /** Kehys, johon uuden ketjun ensimmäinen jakso päättyy. */
  inFrame: Frame
  /** Kehys, josta jälkimmäinen jakso jatkuu. */
  outFrame: Frame
  added: Record<string, number>
  removed: Record<string, number>
}

/**
 * Tasoristeykset annettuun risteämään. Risteyspala upotetaan vanhalle
 * suoralle osuudelle niin, että sen poikittainen reitti osuu piirretyn viivan
 * kulkusuuntaan — suunnan on täsmättävä 45°-lokeroon asti, koska sijoituksen
 * kierto on kokonainen lokero eikä sitä voi jakaa liitoksille.
 */
export function levelCrossings(
  base: TrackChain,
  library: PieceLibrary,
  table: FillTable,
  inventory: Inventory,
  site: CrossingSite,
  open: Connector,
): LevelCrossing[] {
  const placed = base.pieces[site.baseIndex]
  if (!isSoftPiece(library.get(placed.pieceId))) return []
  const section = naturalSection(base, library, site.baseIndex)
  if (!section?.replaceable) return []

  const results: LevelCrossing[] = []

  for (const piece of crossingPieces(library)) {
    // Peilaus vaihtaa poikittaisen raiteen liitinsukupuolten suunnan: se on
    // ainoa tapa saada ketju kulkemaan risteyksen läpi molempiin suuntiin,
    // ja palakirjasto kertoo datassa kummat palat sen sallivat.
    for (const { order, mirror } of placements(piece)) {
      const core = pieceCore(library, piece.id, order, mirror)
      const probe = core(section.start)
      if (!probe) continue

      const route = branchRoute(probe.placed[0], piece, site.heading, open)
      if (!route) continue

      // Risteyspalan poikittaisreitin keskikohta on sen oma ankkuri: juuri se
      // on osuttava kohtaan, jossa viiva ylittää radan.
      const centreAlongMm = alongOf(section, midpoint(route.enter, route.leave))
      const targetAlongMm = alongOf(section, site.point) - centreAlongMm

      const inserted = insertIntoRun(base, library, table, inventory, section, core, targetAlongMm)
      if (!inserted) continue

      const world = branchRoute(inserted.pieces[inserted.coreStart], piece, site.heading, open)
      if (!world) continue

      results.push({
        crossingId: piece.id,
        pieces: inserted.pieces,
        joints: inserted.joints,
        crossingIndex: inserted.coreStart,
        localJoints: inserted.localJoints,
        gapMm: inserted.gapMm,
        // Sisääntulokehys on maali, johon ketju saapuu: suunta portista sisään
        // ja liitin sen vastapari. Ulostulokehys osoittaa portista ulos.
        inFrame: arrivalFrame(world.enter),
        outFrame: departureFrame(world.leave),
        added: inserted.added,
        removed: inserted.removed,
      })
      break
    }
  }

  return results
}

/**
 * Poikittaisreitti, jota pitkin uusi ketju kulkee palan läpi annetussa
 * suunnassa. Suunnan lisäksi ratkaisee liittimen sukupuoli: haara kulkee
 * socket -> pin koko matkan, joten sen on tultava sisään koloon ja päästävä
 * ulos tapista. Juuri tästä syystä risteyspalasta tarvitaan molemmat
 * peilikuvat — BRIO toimittaa H:n kahtena kappaleena samasta syystä.
 */
function branchRoute(
  placed: PlacedPiece,
  piece: ResolvedPiece,
  heading: Dir,
  open: Connector,
): { enter: Port; leave: Port } | null {
  const ports = branchPortsOf(placed, piece)
  for (const enter of ports) {
    for (const leave of ports) {
      if (enter.id === leave.id) continue
      // Sisääntuloportti osoittaa ulospäin, joten ketju saapuu sen vastasuuntaan.
      if (oppositeDir(enter.dir) !== heading || leave.dir !== heading) continue
      if (enter.connector !== complementOf(open) || leave.connector !== open) continue
      return { enter, leave }
    }
  }
  return null
}

/** Kehys, johon portin kautta saavutaan: ketju päättyy tähän. */
function arrivalFrame(port: Port): Frame {
  return { x: port.x, y: port.y, dir: oppositeDir(port.dir), level: port.levelOffset, open: complementOf(port.connector) }
}

/** Kehys, josta portin kautta jatketaan: ketju lähtee tästä. */
function departureFrame(port: Port): Frame {
  return { x: port.x, y: port.y, dir: port.dir, level: port.levelOffset, open: port.connector }
}

function midpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** Etenemä osuuden alusta; osuus on suora, joten projektio riittää. */
function alongOf(section: Section, point: Vec): number {
  const dx = section.end.x - section.start.x
  const dy = section.end.y - section.start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return 0
  return ((point.x - section.start.x) * dx + (point.y - section.start.y) * dy) / Math.sqrt(lengthSq)
}

function placements(piece: ResolvedPiece): { order: { entryPortId: string; exitPortId: string }; mirror: boolean }[] {
  const [a, b] = piece.mainPorts
  if (!a || !b) return []
  const orders = [
    { entryPortId: a.id, exitPortId: b.id },
    { entryPortId: b.id, exitPortId: a.id },
  ]
  const mirrors = piece.mirrorable ? [false, true] : [false]
  return orders.flatMap((order) => mirrors.map((mirror) => ({ order, mirror })))
}

export interface BridgeOver {
  elementId: string
  /** Uusi ketju sillan kanssa; liitokset ovat peräkkäiset kuten ennenkin. */
  pieces: PlacedPiece[]
  gapMm: number
  added: Record<string, number>
  removed: Record<string, number>
}

/**
 * Nostaa uuden ketjun vanhan radan yli. Silta on mäkielementti
 * (`data/elements/`: ramppi ylös, kansi, ramppi alas), joten se on dataa eikä
 * koodia — myös liitinparillisuus on siellä ratkaistu.
 *
 * Silta upotetaan ketjun suoralle osuudelle samalla koneistolla kuin vaihde
 * vanhalle radalle: osuuden pituus säilyy, joten ketjun loppupää ei liiku.
 * Ainoa lisäehto on, että risteämän on jäätävä **kannen alle** — rampit ovat
 * lattialla eivätkä ne saa osua alittavaan rataan.
 */
export function bridgeOver(
  chain: readonly PlacedPiece[],
  library: PieceLibrary,
  elements: ElementLibrary,
  table: FillTable,
  inventory: Inventory,
  site: CrossingSite,
): BridgeOver | null {
  const chainTrack: TrackChain = { pieces: chain, joints: consecutiveJoints(chain.length) }
  const run = straightRunAround(chainTrack, library, site.chainIndex)
  if (!run) return null

  for (const element of elements.byRole('hill')) {
    const core: RunCore = (cursor) => {
      const traversal = traverseElement(element.spec, library, new Ledger({ unlimited: true, counts: {} }), cursor, false)
      return traversal ? { placed: traversal.placed, exit: traversal.exit } : null
    }
    const probe = core(run.start)
    if (!probe) continue

    const deck = deckSpan(probe, library, run)
    if (!deck) continue

    // Risteämän on osuttava kannen alle: ytimen etenemä valitaan niin, että
    // kansi tulee sen päälle.
    const siteAlongMm = alongOf(run, site.point)
    const targetAlongMm = siteAlongMm - (deck.startMm + deck.endMm) / 2
    const range = {
      minMm: siteAlongMm - deck.endMm + DECK_MARGIN_MM,
      maxMm: siteAlongMm - deck.startMm - DECK_MARGIN_MM,
    }
    if (range.minMm > range.maxMm) continue

    const inserted = insertIntoRun(chainTrack, library, table, inventory, run, core, targetAlongMm, range)
    if (!inserted) continue

    return {
      elementId: element.id,
      pieces: inserted.pieces,
      gapMm: inserted.gapMm,
      added: inserted.added,
      removed: inserted.removed,
    }
  }
  return null
}

/** Kannen alku ja loppu ytimen etenemänä mitattuna. */
function deckSpan(
  probe: { placed: PlacedPiece[] },
  library: PieceLibrary,
  run: Section,
): { startMm: number; endMm: number } | null {
  for (const placed of probe.placed) {
    const piece = library.get(placed.pieceId)
    if (!piece.tags.includes('bridge-deck')) continue
    return {
      startMm: alongOf(run, entryFrame(placed, piece)),
      endMm: alongOf(run, exitFrame(placed, piece)),
    }
  }
  return null
}

function consecutiveJoints(count: number): [number, number][] {
  const joints: [number, number][] = []
  for (let i = 1; i < count; i += 1) joints.push([i - 1, i])
  return joints
}

/**
 * Suora osuus ketjussa annetun palan ympärillä. Silta tarvitsee suoraa
 * molemmin puolin risteämää, joten kaari katkaisee osuuden samalla tavalla
 * kuin osiovalinnassa.
 */
function straightRunAround(chain: TrackChain, library: PieceLibrary, index: number): Section | null {
  if (!isSoftPiece(library.get(chain.pieces[index].pieceId))) return null
  const section = naturalSection(chain, library, index)
  return section?.replaceable ? section : null
}
