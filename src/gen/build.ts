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
  const start = startFrame(skeleton.startPoint.x, skeleton.startPoint.y, skeleton.startDir, 0, 'pin')
  let cursor: Frame = start

  for (let i = 0; i < skeleton.corners.length; i += 1) {
    const corner = skeleton.corners[i]
    const element = elements.byId.get(corner.elementId)
    if (!element) return null
    const turned = traverseElement(element.spec, library, ledger, cursor, corner.mirror)
    if (!turned) return null
    pieces.push(...turned.placed)
    cursor = turned.exit

    let remainingMm = skeleton.runsMm[i]

    const hillId = skeleton.hills[i]
    if (hillId !== undefined) {
      const hill = elements.byId.get(hillId)
      if (!hill || hill.alongMm > remainingMm + 1e-6) return null
      const climbed = traverseElement(hill.spec, library, ledger, cursor, false)
      if (!climbed) return null
      pieces.push(...climbed.placed)
      cursor = climbed.exit
      remainingMm -= hill.alongMm
    }

    // Osuuskohtainen haara satunnaisvirrasta: yhden osuuden täytön voi arpoa
    // uudelleen koskematta muihin (refill-run-mutaatio).
    const fill = solveFill(library, ledger, rng.fork(skeleton.fillSalts[i]), { distanceMm: remainingMm })
    if (fill === null) return null
    for (const pieceId of fill) {
      const result = placeAtFrame(library.get(pieceId), cursor, { allowConnectorFlip: context.allowConnectorFlip })
      if (!result) return null
      pieces.push(result.placed)
      cursor = result.exit
    }
  }

  const closure = evaluateClosure(
    jointsForChain(pieces.map((placed) => library.get(placed.pieceId)), true),
    {
      gapMm: Math.hypot(cursor.x - start.x, cursor.y - start.y),
      angleDeg: angleDifferenceDeg(dirToDegrees(cursor.dir), dirToDegrees(start.dir)),
    },
    { settings: context.vario, flex: context.flex, seamIndex: 0, spread: 0 },
  )

  const footprints = pieces.map((placed) => placedFootprint(placed, library.get(placed.pieceId)))
  const bbox = unionBBox(footprints.flat().map(polygonBBox))
  const area = areaBounds(context.mask)
  const fitsArea = bbox.minX >= area.minX && bbox.minY >= area.minY && bbox.maxX <= area.maxX && bbox.maxY <= area.maxY

  return {
    pieces,
    lengthMm: pieces.reduce((sum, placed) => sum + library.get(placed.pieceId).lengthMm, 0),
    bbox,
    closure,
    usage: ledger.usage(),
    shortages: ledger.shortages(),
    maxLevel: pieces.reduce((max, placed) => Math.max(max, placed.placement.level + library.get(placed.pieceId).levelDelta), 0),
    fitsArea,
    collisions: countCollisions(pieces, library),
  }
}

/**
 * Törmäystarkistus: keskilinjat näytteistetään ja verrataan pareittain. Vain
 * samalla tasolla (tai tasoväliltään limittäiset) palat voivat törmätä —
 * ylikulku on nimenomaan sallittu (README luku 4).
 */
export function countCollisions(pieces: readonly PlacedPiece[], library: PieceLibrary): number {
  const samples = pieces.map((placed) => samplePath(placedSegments(placed, library.get(placed.pieceId))))
  const boxes = samples.map((points) => polygonBBox(points))
  const levels = pieces.map((placed) => {
    const piece = library.get(placed.pieceId)
    return { low: placed.placement.level, high: placed.placement.level + piece.levelDelta }
  })

  const threshold = TRACK_WIDTH_MM * 0.9
  let collisions = 0

  for (let i = 0; i < pieces.length; i += 1) {
    for (let j = i + 2; j < pieces.length; j += 1) {
      // Ketjussa vierekkäiset palat koskettavat toisiaan liitoksessa; myös
      // silmukan sulkeva pari on vierekkäinen.
      if (i === 0 && j === pieces.length - 1) continue
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
