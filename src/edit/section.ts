import type { PieceLibrary } from '../core/library'
import { samplePath } from '../core/path'
import {
  entryFrame,
  exitFrame,
  placedPorts,
  placedSegments,
  type Frame,
  type PlacedPiece,
  type ResolvedPiece,
} from '../core/pieces'
import { CELL_MM, TRACK_WIDTH_MM } from '../core/units'
import type { Vec } from '../core/vec'
import { areaOutline, type AreaShape } from '../gen/mask'

// Osion valinta (README luku 6): napautus suoralle osuudelle valitsee koko
// luonnollisen jakson, joka katkeaa koviin kohtiin — kaariin, vaihteisiin ja
// ramppeihin. Päätykahvat liukuvat rataa pitkin ja napsahtavat palarajoihin,
// jolloin valinnan saa venytettyä myös mutkien yli.
//
// Osio on pelkkä näkymä rataan: se ei omista paloja eikä muuta niitä. Korvaus
// (replace.ts) rakentaa uuden radan tämän kuvauksen pohjalta.

/**
 * Se osa radasta, jota osion rajaus tarvitsee. Lisäävä piirto kokoaa rataa
 * välivaiheissa, joissa mitattuja tunnuslukuja (pituus, törmäykset) ei vielä
 * ole — rajaus ei niitä kaipaa, joten se pyytää vain palat ja liitokset.
 */
export interface TrackChain {
  pieces: readonly PlacedPiece[]
  joints: readonly [number, number][]
}

/** Näin pitkälle päätykahvat liukuvat; pidempi osio ei enää ole "osio". */
export const MAX_SECTION_PIECES = 14

/**
 * Porttien osumatoleranssi ketjua kuljettaessa. Sulkeutumisjäännös jaetaan
 * liitoksille (`relaxClosure`), joten naapuripalojen portit eivät osu
 * täsmälleen päällekkäin vaan jäävät alle millin päähän toisistaan.
 */
const JOIN_EPS_MM = 8

/** Sivutila mitataan enintään tähän asti: kauempi vapaa lattia ei enää kerro mitään. */
const MAX_CORRIDOR_MM = CELL_MM * 3

/** Sivutilaa ei mitata aivan osion päistä, joissa naapuripalat ovat kiinni. */
const CORRIDOR_END_MARGIN_MM = TRACK_WIDTH_MM

/** Alueen ääriviiva näytteistetään tällä tiheydellä sivutilan mittausta varten. */
const OUTLINE_STEP_MM = 60

export interface Section {
  /** Palat ketjujärjestyksessä: `indices[0]`:n sisääntulo on osion alku. */
  indices: number[]
  /** Kiinnitetty aloituskehys — ensimmäisen palan sisääntuloportti. */
  start: Frame
  /** Kiinnitetty päätekehys — viimeisen palan ulostuloportti. */
  end: Frame
  /** Osiota edeltävä pala, tai null jos ketju alkaa tästä. */
  before: number | null
  /** Osion jälkeinen pala, tai null jos ketju päättyy tähän. */
  after: number | null
  /**
   * Voiko osion korvata piirtämällä? Korvaus kiinnittyy päätyportteihin ja
   * kokoaa niiden väliin uuden ketjun, joten osiosta ulos johtavia liitoksia
   * saa olla vain sen päissä, päiden on oltava samalla tasolla eikä valinta saa
   * sulkeutua itseensä.
   */
  replaceable: boolean
  /**
   * Voiko osion poistaa? Poisto on löysempi ehto kuin korvaus: se ei kokoa
   * mitään tilalle, joten keskeltä lähtevä haara ei ole este — se vain jää
   * lattialle irralleen, aivan kuten oikeasti kävisi. Ainoa este on koko radan
   * poistaminen: tyhjä rata ei ole rata, jonka kartta osaisi piirtää, ja pöydän
   * tyhjentämiseen on oma nappinsa.
   */
  removable: boolean
}

/** Radan avoin pää: portti, johon ei ole liitetty mitään. */
export interface FreeEnd {
  /** Palan indeksi radalla. */
  index: number
  portId: string
  /** Kehys ulospäin: uusi ketju jatkuu tästä. */
  frame: Frame
}

/**
 * Radan avoimet päät. Näitä on kolmenlaisia, ja kaikki kolme ovat sama asia
 * lattialla: kiskonpää johon voi työntää lisää rataa — piirretyn radan pää,
 * piirretyn haaran vapaa pää ja vaihteen käyttämättä jäänyt haaraportti.
 *
 * Ilman tätä koodi ei tuntenut radan päitä lainkaan: piirto niiden vierestä
 * luki tilanteen haaraksi ja työnsi vaihteen viereen, ja poisto luuli päätä
 * porttipariksi jonka väliin jää aukko.
 */
export function freeEnds(track: TrackChain, library: PieceLibrary): FreeEnd[] {
  const neighbours = neighbourLists(track)
  const ends: FreeEnd[] = []

  track.pieces.forEach((placed, index) => {
    const piece = library.get(placed.pieceId)
    for (const port of placedPorts(placed, piece)) {
      const joined = neighbours[index].some((other) =>
        touches(track, library, other, { x: port.x, y: port.y, dir: port.dir, level: port.levelOffset, open: port.connector }),
      )
      if (joined) continue
      ends.push({
        index,
        portId: port.id,
        frame: { x: port.x, y: port.y, dir: port.dir, level: port.levelOffset, open: port.connector },
      })
    }
  })

  return ends
}

/**
 * Pitääkö liitos yhä? Palan vaihto voi viedä portin, johon jokin oli kiinni:
 * kolmisuuntaisen vaihteen tilalle vaihdettu suora ei tarjoa haaraporttia, ja
 * siihen liitetty haara jää lattialle irralleen. Liitos on kirjanpitoa, ja sen
 * on vastattava sitä mitä lattialla on.
 */
export function jointHolds(pieces: readonly PlacedPiece[], library: PieceLibrary, a: number, b: number): boolean {
  const left = placedPorts(pieces[a], library.get(pieces[a].pieceId))
  const right = placedPorts(pieces[b], library.get(pieces[b].pieceId))
  return left.some((port) => right.some((other) => Math.hypot(port.x - other.x, port.y - other.y) <= JOIN_EPS_MM))
}

/** Naapuriluettelo liitoksista: pala -> siihen liitetyt palat. */
export function neighbourLists(track: TrackChain): number[][] {
  const lists = track.pieces.map(() => [] as number[])
  for (const [a, b] of track.joints) {
    if (!lists[a].includes(b)) lists[a].push(b)
    if (!lists[b].includes(a)) lists[b].push(a)
  }
  return lists
}

/**
 * Pehmeä pala on osuuden sisustaa, kova pala sen raja. Kaaret, vaihteet,
 * rampit ja sillan kannet ovat kovia kohtia (README luku 6).
 */
export function isSoftPiece(piece: ResolvedPiece): boolean {
  return piece.kind === 'straight' && !piece.tags.includes('bridge-deck')
}

function isSoft(track: TrackChain, library: PieceLibrary, index: number): boolean {
  return isSoftPiece(library.get(track.pieces[index].pieceId))
}

function framesOf(track: TrackChain, library: PieceLibrary, index: number): { entry: Frame; exit: Frame } {
  const placed = track.pieces[index]
  const piece = library.get(placed.pieceId)
  return { entry: entryFrame(placed, piece), exit: exitFrame(placed, piece) }
}

/**
 * Onko palalla portti annetussa kehyksessä? Haaraportit lasketaan mukaan, joten
 * risteyksen sivuhaara tunnistetaan naapuriksi siinä missä läpimenevä reittikin.
 */
function touches(track: TrackChain, library: PieceLibrary, index: number, at: Frame): boolean {
  const placed = track.pieces[index]
  const piece = library.get(placed.pieceId)
  return placedPorts(placed, piece).some((port) => Math.hypot(port.x - at.x, port.y - at.y) <= JOIN_EPS_MM)
}

/** Ketjussa seuraava pala: se naapuri, joka on kiinni tämän palan ulostulossa. */
function forwardOf(track: TrackChain, library: PieceLibrary, neighbours: number[][], index: number): number | null {
  const { exit } = framesOf(track, library, index)
  return neighbours[index].find((other) => touches(track, library, other, exit)) ?? null
}

/** Ketjussa edellinen pala: se naapuri, joka on kiinni tämän palan sisääntulossa. */
function backwardOf(track: TrackChain, library: PieceLibrary, neighbours: number[][], index: number): number | null {
  const { entry } = framesOf(track, library, index)
  return neighbours[index].find((other) => touches(track, library, other, entry)) ?? null
}

/**
 * Kokoaa osion valmiiksi järjestetystä palalistasta ja päättelee sen päätyportit
 * sekä korvattavuuden.
 */
export function makeSection(track: TrackChain, library: PieceLibrary, indices: readonly number[]): Section | null {
  if (indices.length === 0) return null
  const list = [...indices]
  const inside = new Set(list)
  const neighbours = neighbourLists(track)

  const first = list[0]
  const last = list[list.length - 1]
  const start = framesOf(track, library, first).entry
  const end = framesOf(track, library, last).exit

  // Naapurin puuttuminen ja naapuri osion sisältä ovat eri asioita, vaikka
  // kummassakin naapuria ei ole *ulkopuolella*:
  //
  // - **Naapuri osion sisältä** tarkoittaa että valinta sulkeutuu itseensä.
  //   Silloin päätyportteja ei ole: alku ja loppu ovat sama piste, eikä
  //   ketjua saa liitettyä mihinkään.
  // - **Naapuria ei ole lainkaan** tarkoittaa radan avointa päätä. Se on täysin
  //   kelvollinen kiinnityskohta ja pysyy paikallaan, koska osuuden pituus
  //   säilyy — kiskonpää on siellä minne se jäi.
  //
  // Ero on olennainen: ilman sitä pelkistä suorista koostuvalta avoimelta
  // radalta ei voinut haaroittaa lainkaan, koska koko rata on yksi osio ja sen
  // molemmat naapurit "puuttuvat".
  const backward = backwardOf(track, library, neighbours, first)
  const forward = forwardOf(track, library, neighbours, last)
  const before = backward !== null && !inside.has(backward) ? backward : null
  const after = forward !== null && !inside.has(forward) ? forward : null
  const cyclic = (backward !== null && inside.has(backward)) || (forward !== null && inside.has(forward))

  // Korvaus purkaa osion ja liittää tilalle uuden ketjun, joten osiosta ulos
  // johtavia liitoksia saa olla vain sen päissä. Muuten keskeltä lähtevä haara
  // jäisi purkamisen jälkeen roikkumaan irrallaan.
  const branchFree = list.every((index) =>
    neighbours[index].every(
      (other) => inside.has(other) || (index === first && other === before) || (index === last && other === after),
    ),
  )

  // Tasoa vaihtava osio (mäki) vaatisi ramppeja, joita sovitus ei sijoita;
  // itseensä sulkeutuvalla valinnalla ei ole päätyportteja mihin kiinnittyä.
  const unique = new Set(list).size === list.length
  const replaceable = branchFree && !cyclic && unique && start.level === end.level
  const removable = unique && list.length < track.pieces.length

  return { indices: list, start, end, before, after, replaceable, removable }
}

/**
 * Luonnollinen jakso napautetun palan ympäriltä: pehmeitä paloja kumpaankin
 * suuntaan, kunnes tulee kova kohta. Kovaa palaa napautettaessa osio on se
 * yksi pala — päätykahvoilla sitä voi sitten venyttää.
 */
export function naturalSection(track: TrackChain, library: PieceLibrary, index: number): Section | null {
  if (index < 0 || index >= track.pieces.length) return null
  const neighbours = neighbourLists(track)
  const list = [index]

  if (isSoft(track, library, index)) {
    let cursor = index
    while (list.length < MAX_SECTION_PIECES) {
      const next = forwardOf(track, library, neighbours, cursor)
      if (next === null || list.includes(next) || !isSoft(track, library, next)) break
      list.push(next)
      cursor = next
    }
    cursor = index
    while (list.length < MAX_SECTION_PIECES) {
      const previous = backwardOf(track, library, neighbours, cursor)
      if (previous === null || list.includes(previous) || !isSoft(track, library, previous)) break
      list.unshift(previous)
      cursor = previous
    }
  }

  return makeSection(track, library, list)
}

/** Päätykahvan sijainti kartalla. */
export function handlePoint(section: Section, which: 'start' | 'end'): Vec {
  const frame = which === 'start' ? section.start : section.end
  return { x: frame.x, y: frame.y }
}

/**
 * Kaikki asennot, joihin päätykahva voi napsahtaa: osiota kutistetaan pala
 * kerrallaan ja kasvatetaan ketjua pitkin. Nykyinen osio on aina mukana, joten
 * kahvan voi vetää takaisin lähtöpaikkaansa.
 */
export function slideCandidates(track: TrackChain, library: PieceLibrary, section: Section, which: 'start' | 'end'): Section[] {
  const neighbours = neighbourLists(track)
  const candidates: Section[] = []

  for (let drop = 0; drop < section.indices.length; drop += 1) {
    const indices =
      which === 'start' ? section.indices.slice(drop) : section.indices.slice(0, section.indices.length - drop)
    const candidate = makeSection(track, library, indices)
    if (candidate) candidates.push(candidate)
  }

  let grown = [...section.indices]
  while (grown.length < MAX_SECTION_PIECES) {
    const next =
      which === 'start'
        ? backwardOf(track, library, neighbours, grown[0])
        : forwardOf(track, library, neighbours, grown[grown.length - 1])
    if (next === null || grown.includes(next)) break
    grown = which === 'start' ? [next, ...grown] : [...grown, next]
    const candidate = makeSection(track, library, grown)
    if (candidate) candidates.push(candidate)
  }

  return candidates
}

/** Vetää päätykahvan lähimpään palarajaan. Palauttaa nykyisen osion, jos parempaa ei ole. */
export function slideSectionEnd(
  track: TrackChain,
  library: PieceLibrary,
  section: Section,
  which: 'start' | 'end',
  target: Vec,
): Section {
  let best = section
  let bestDistance = Infinity
  for (const candidate of slideCandidates(track, library, section, which)) {
    const point = handlePoint(candidate, which)
    const distance = Math.hypot(point.x - target.x, point.y - target.y)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

export interface SectionBrief {
  pieceCount: number
  /** Osuuden pituus keskilinjaa pitkin. */
  lengthMm: number
  level: number
  /** Vapaa käytävä kulkusuunnasta katsoen vasemmalla / oikealla. */
  leftMm: number
  rightMm: number
  /** Purkamisesta vapautuvat palat (README luku 6: "vapauttaa 1×D"). */
  freed: Record<string, number>
}

/**
 * Osuuden tehtävänanto (README luku 6): pituus, taso, sivuttaistila ja
 * purkamisesta vapautuvat palat. Sama tieto näytetään käyttäjälle ja syötetään
 * myöhemmin autosolverille.
 */
export function sectionBrief(track: TrackChain, library: PieceLibrary, area: AreaShape, section: Section): SectionBrief {
  const freed: Record<string, number> = {}
  let lengthMm = 0
  for (const index of section.indices) {
    const placed = track.pieces[index]
    freed[placed.pieceId] = (freed[placed.pieceId] ?? 0) + 1
    lengthMm += library.get(placed.pieceId).lengthMm
  }

  return {
    pieceCount: section.indices.length,
    lengthMm,
    level: section.start.level,
    ...corridor(track, library, area, section),
    freed,
  }
}

/** Osion keskilinja yhtenä näytteistettynä murtoviivana. */
export function sectionPolyline(track: TrackChain, library: PieceLibrary, section: Section): Vec[] {
  const points: Vec[] = []
  for (const index of section.indices) {
    const placed = track.pieces[index]
    for (const point of samplePath(placedSegments(placed, library.get(placed.pieceId)), 20)) {
      const previous = points[points.length - 1]
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.5) points.push(point)
    }
  }
  return points
}

/**
 * Sivuttaistila: kuinka leveä vapaa käytävä osuuden kummallakin puolella on.
 * Esteitä ovat radan muut palat samalta tasoväliltä ja lattia-alueen reuna.
 * Mittaus tehdään osion keskeltä — päissä naapuripalat ovat määritelmän
 * mukaan kiinni eivätkä kerro tilasta mitään.
 */
function corridor(
  track: TrackChain,
  library: PieceLibrary,
  area: AreaShape,
  section: Section,
): { leftMm: number; rightMm: number } {
  const centre = sectionPolyline(track, library, section)
  if (centre.length < 2) return { leftMm: 0, rightMm: 0 }

  const cum = [0]
  for (let i = 1; i < centre.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(centre[i].x - centre[i - 1].x, centre[i].y - centre[i - 1].y))
  }
  const totalMm = cum[cum.length - 1]

  let leftMm = MAX_CORRIDOR_MM
  let rightMm = MAX_CORRIDOR_MM

  const consider = (point: Vec): void => {
    const hit = projectSigned(centre, cum, point)
    if (hit.alongMm < CORRIDOR_END_MARGIN_MM || hit.alongMm > totalMm - CORRIDOR_END_MARGIN_MM) return
    // Kaksi puolikasta lautaa mahtuu aina väliin, joten vapaa tila on
    // keskilinjaväli miinus laudan leveys.
    const freeMm = Math.max(0, Math.abs(hit.lateralMm) - TRACK_WIDTH_MM)
    if (hit.lateralMm < 0) leftMm = Math.min(leftMm, freeMm)
    else rightMm = Math.min(rightMm, freeMm)
  }

  const inside = new Set(section.indices)
  const level = section.start.level
  for (let index = 0; index < track.pieces.length; index += 1) {
    if (inside.has(index)) continue
    const placed = track.pieces[index]
    const piece = library.get(placed.pieceId)
    // Eri tasolla kulkeva rata ei vie sivutilaa: ylikulku on nimenomaan sallittu.
    if (level < placed.placement.level || level > placed.placement.level + piece.levelDelta) continue
    for (const point of samplePath(placedSegments(placed, piece), 25)) consider(point)
  }

  for (const point of outlineSamples(area)) consider(point)

  return { leftMm, rightMm }
}

/** Etenemä ja etumerkillinen sivuttaisetäisyys murtoviivalla; positiivinen = kulkusuunnasta oikealle. */
function projectSigned(points: readonly Vec[], cum: readonly number[], q: Vec): { alongMm: number; lateralMm: number } {
  let bestDistance = Infinity
  let alongMm = 0
  let lateralMm = 0

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]
    const to = points[i]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const lengthSq = dx * dx + dy * dy
    if (lengthSq === 0) continue
    const t = Math.max(0, Math.min(1, ((q.x - from.x) * dx + (q.y - from.y) * dy) / lengthSq))
    const footX = from.x + dx * t
    const footY = from.y + dy * t
    const distance = Math.hypot(q.x - footX, q.y - footY)
    if (distance >= bestDistance) continue
    const length = Math.sqrt(lengthSq)
    bestDistance = distance
    alongMm = cum[i - 1] + length * t
    // Oikea puoli on `offsetPolyline`-mielessä normaali (-dy, dx).
    lateralMm = (-(q.x - footX) * dy + (q.y - footY) * dx) / length
  }

  return { alongMm, lateralMm }
}

/** Alueen ääriviiva tasavälisinä pisteinä. */
function outlineSamples(area: AreaShape): Vec[] {
  const corners = areaOutline(area)
  const samples: Vec[] = []
  for (let i = 0; i < corners.length; i += 1) {
    const from = corners[i]
    const to = corners[(i + 1) % corners.length]
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    const steps = Math.max(1, Math.ceil(length / OUTLINE_STEP_MM))
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps
      samples.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t })
    }
  }
  return samples
}
