import { angleDifferenceDeg, dirToDegrees } from '../core/dir'
import { solveFill, type FillTable } from '../core/fill'
import type { Ledger } from '../core/inventory'
import type { PieceLibrary } from '../core/library'
import { bboxesOverlap, polygonBBox, samplePath, unionBBox, type BBox } from '../core/path'
import type { Vec } from '../core/vec'
import { placeAtFrame, placedFootprint, placedSegments, startFrame, type Frame, type PlacedPiece } from '../core/pieces'
import type { Rng } from '../core/rng'
import { TRACK_WIDTH_MM } from '../core/units'
import { evaluateClosure, jointsForChain, type ClosureReport, type FlexSettings, type VarioSettings } from '../core/vario'
import { traverseElement, type ElementLibrary } from './elements'
import { areaBounds, type CellMask } from './mask'
import type { Skeleton } from './skeleton'

// Rungon materialisointi paloiksi. Jokainen vaihe joko onnistuu kokonaan tai
// palauttaa null ja vapauttaa varauksensa — rata on joka välivaiheessa ehjä.

export interface BuildContext {
  library: PieceLibrary
  elements: ElementLibrary
  table: FillTable
  mask: CellMask
  vario?: VarioSettings
  flex?: FlexSettings
  /**
   * Asetus "salli kääntö/adapterit" (README luku 2). Suljetussa silmukassa
   * liittimen sukupuoli on globaali invariantti: jokainen väärinpäin kuljettu
   * pala rikkoo kaksi liitosta. Mäki tarvitsee laskevan rampin, joten se vaatii
   * tämän asetuksen — tai keskenään sukupuolitetun ramppiparin, jonka koodeja
   * ei ole voitu tarkistaa lähteestä (docs/PIECE_LIBRARY.md).
   */
  allowConnectorFlip?: boolean
}

export interface Track {
  pieces: PlacedPiece[]
  /** Liitokset paloparien välillä `pieces`-indekseinä, sauma mukaan lukien. */
  joints: [number, number][]
  /** Radan pituus keskilinjasummana (README luku 7). */
  lengthMm: number
  /** Äärimitat jalanjälkien ympäriltä. */
  bbox: BBox
  closure: ClosureReport
  usage: Record<string, number>
  shortages: Record<string, number>
  /** Korkein käytetty taso (0 = vain lattia). */
  maxLevel: number
  fitsArea: boolean
  collisions: number
}

export function materialise(skeleton: Skeleton, context: BuildContext, ledger: Ledger, rng: Rng): Track | null {
  const { library, elements } = context
  const pieces: PlacedPiece[] = []
  // Liitokset kirjataan erikseen: sivuhaaran jälkeen taulukkojärjestys ei enää
  // vastaa ketjun järjestystä.
  const joints: [number, number][] = []
  let previous = -1

  const appendTraversal = (traversal: { placed: PlacedPiece[]; edges: [number, number][]; lastIndex: number }): void => {
    const base = pieces.length
    pieces.push(...traversal.placed)
    for (const [a, b] of traversal.edges) joints.push([base + a, base + b])
    if (previous >= 0) joints.push([previous, base])
    previous = base + traversal.lastIndex
  }

  const appendPiece = (placed: PlacedPiece): void => {
    const index = pieces.push(placed) - 1
    if (previous >= 0) joints.push([previous, index])
    previous = index
  }

  const start = startFrame(skeleton.startPoint.x, skeleton.startPoint.y, skeleton.startDir, 0, 'pin')
  let cursor: Frame = start

  for (let i = 0; i < skeleton.corners.length; i += 1) {
    const corner = skeleton.corners[i]
    const element = elements.byId.get(corner.elementId)
    if (!element) return null
    const turned = traverseElement(element.spec, library, ledger, cursor, corner.mirror)
    if (!turned) return null
    appendTraversal(turned)
    cursor = turned.exit

    let remainingMm = skeleton.runsMm[i]

    // Osuuteen upotettu elementti (mäki, sivuraide) syö osan suorasta osuudesta;
    // loppu täytetään tavalliseen tapaan.
    const insertId = skeleton.inserts[i]
    if (insertId !== undefined) {
      const insert = elements.byId.get(insertId)
      if (!insert || insert.alongMm > remainingMm + 1e-6) return null
      const inserted = traverseElement(insert.spec, library, ledger, cursor, false)
      if (!inserted) return null
      appendTraversal(inserted)
      cursor = inserted.exit
      remainingMm -= insert.alongMm
    }

    // Osuuskohtainen haara satunnaisvirrasta: yhden osuuden täytön voi arpoa
    // uudelleen koskematta muihin (refill-run-mutaatio).
    const fill = solveFill(library, ledger, rng.fork(skeleton.fillSalts[i]), { distanceMm: remainingMm })
    if (fill === null) return null
    for (const pieceId of fill) {
      const result = placeAtFrame(library.get(pieceId), cursor, { allowConnectorFlip: context.allowConnectorFlip })
      if (!result) return null
      appendPiece(result.placed)
      cursor = result.exit
    }
  }

  // Sauma: viimeinen pala liittyy ensimmäiseen. Liitos ei sulkeudu täsmälleen,
  // joten se on kirjattava naapuruudeksi eikä pääteltävä porttien osumisesta.
  if (previous >= 0 && pieces.length > 1) joints.push([previous, 0])

  const gap: Vec = { x: cursor.x - start.x, y: cursor.y - start.y }
  const closure = evaluateClosure(
    jointsForChain(pieces.map((placed) => library.get(placed.pieceId)), true),
    {
      gapMm: Math.hypot(gap.x, gap.y),
      angleDeg: angleDifferenceDeg(dirToDegrees(cursor.dir), dirToDegrees(start.dir)),
    },
    { settings: context.vario, flex: context.flex, seamIndex: 0, spread: 0 },
  )

  // Kireys on mitattu nimellisgeometriasta, joten luku pysyy rehellisenä myös
  // sen jälkeen kun jäännös jaetaan liitoksille.
  relaxClosure(pieces, gap, previous)

  const footprints = pieces.map((placed) => placedFootprint(placed, library.get(placed.pieceId)))
  const bbox = unionBBox(footprints.flat().map(polygonBBox))
  const area = areaBounds(context.mask)
  const fitsArea = bbox.minX >= area.minX && bbox.minY >= area.minY && bbox.maxX <= area.maxX && bbox.maxY <= area.maxY

  return {
    pieces,
    joints,
    lengthMm: pieces.reduce((sum, placed) => sum + library.get(placed.pieceId).lengthMm, 0),
    bbox,
    closure,
    usage: ledger.usage(),
    shortages: ledger.shortages(),
    maxLevel: pieces.reduce((max, placed) => Math.max(max, placed.placement.level + library.get(placed.pieceId).levelDelta), 0),
    fitsArea,
    collisions: countCollisions(pieces, library, joints),
  }
}

/**
 * Jakaa sulkeutumisjäännöksen koko ketjulle.
 *
 * Nimellisgeometriassa jäännös kasautuu yhteen saumaan, jolloin rata näyttäisi
 * katkeavan siitä. Lattialla näin ei käy: jokainen liitos venyy ja taipuu vähän,
 * ja Vario-budjetti mittaa juuri sitä. Siksi jäännös siirretään tasan liitoksille
 * — silmukka sulkeutuu täsmälleen ja yksittäinen liitos siirtyy alle millin,
 * kaukana turvakatosta. Tämä on sama malli jota `evaluateClosure` jo laskee,
 * nyt vain myös geometriassa.
 */
function relaxClosure(pieces: PlacedPiece[], gap: Vec, chainEnd: number): void {
  if (chainEnd < 1) return
  for (let i = 0; i < pieces.length; i += 1) {
    // Sivuhaaran palat ovat taulukossa kiinnityskohtansa jäljessä, joten ne
    // liikkuvat sen mukana; ketjun pään jälkeen osuus on täysi.
    const share = Math.min(1, i / chainEnd)
    const placement = pieces[i].placement
    pieces[i] = {
      ...pieces[i],
      placement: { ...placement, x: placement.x - gap.x * share, y: placement.y - gap.y * share },
    }
  }
}

/**
 * Törmäystarkistus: keskilinjat näytteistetään ja verrataan pareittain. Vain
 * samalla tasolla (tai tasoväliltään limittäiset) palat voivat törmätä —
 * ylikulku on nimenomaan sallittu (README luku 4).
 */
export function countCollisions(
  pieces: readonly PlacedPiece[],
  library: PieceLibrary,
  joints: readonly [number, number][],
): number {
  const samples = pieces.map((placed) => samplePath(placedSegments(placed, library.get(placed.pieceId))))
  const boxes = samples.map((points) => polygonBBox(points))
  const levels = pieces.map((placed) => {
    const piece = library.get(placed.pieceId)
    return { low: placed.placement.level, high: placed.placement.level + piece.levelDelta }
  })

  // Liitoksessa kiinni olevat palat koskettavat toisiaan määritelmän mukaan.
  const connected = new Set(joints.map(([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`)))
  const threshold = TRACK_WIDTH_MM * 0.9
  let collisions = 0

  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 1; j < pieces.length; j += 1) {
      if (connected.has(`${i},${j}`)) continue
      if (levels[i].low > levels[j].high || levels[j].low > levels[i].high) continue
      if (!bboxesOverlap(grow(boxes[i], threshold), boxes[j])) continue
      if (minDistance(samples[i], samples[j]) < threshold) collisions += 1
    }
  }

  return collisions
}

function grow(box: BBox, marginMm: number): BBox {
  return { minX: box.minX - marginMm, minY: box.minY - marginMm, maxX: box.maxX + marginMm, maxY: box.maxY + marginMm }
}

function minDistance(a: readonly Vec[], b: readonly Vec[]): number {
  let best = Infinity
  for (const p of a) {
    for (const q of b) {
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d < best) best = d
    }
  }
  return best
}
