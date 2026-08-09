import { normalizeDir, type Dir } from '../core/dir'
import { nearestFillable, type FillTable } from '../core/fill'
import type { Ledger } from '../core/inventory'
import type { Rng } from '../core/rng'
import type { Vec } from '../core/vec'
import type { ElementLibrary, ResolvedElement } from './elements'
import { cellCenter, type CellMask } from './mask'
import { turnAt, type CellCycle } from './route'

// Runko: solureitti puretaan kulmiksi ja suoriksi osuuksiksi. Kulmat ovat
// elementtejä (2 x E jne.), suorat täytetään Solver-taulukosta. Terävä
// solupolyline sulkeutuu aina täsmälleen, ja kulman sisääntulo- ja
// ulostulomitat kumoutuvat kierroksen yli — ainoa virhe syntyy siitä, että
// suorat on pyöristettävä täytettäviin pituuksiin. Se jää Vario-budjetille.

export interface SkeletonCorner {
  elementId: string
  /** Kierretään vasemmalle: elementti peilataan. */
  mirror: boolean
  alongMm: number
  acrossMm: number
}

export interface Skeleton {
  /** Kohdistimen lähtöpiste: kulman 0 sisääntulo. */
  startPoint: Vec
  /** Kulmaan 0 saapuva suunta. */
  startDir: Dir
  corners: SkeletonCorner[]
  /** runsMm[i] = suora osuus kulman i jälkeen. */
  runsMm: number[]
  /** Terävän solupolylinen kulmapisteet ja osuuksien suunnat/pituudet. */
  cornerPoints: Vec[]
  legDirs: Dir[]
  legLengthsMm: number[]
  /** Osuuteen upotetut elementit (mäki, sivuraide): legIndex -> elementin tunnus. */
  inserts: Record<number, string>
  /** Osuuskohtainen täyttösiemen, jotta yksittäisen osuuden voi arpoa uudelleen. */
  fillSalts: number[]
  /** Sulkeutumisjäännös pyöristyksen jälkeen (mm, akseleittain). */
  residual: Vec
}

const AXIS_DIRS: Record<string, Dir> = { '1,0': 0, '0,1': 2, '-1,0': 4, '0,-1': 6 }

function legDirBetween(from: Vec, to: Vec): Dir {
  const dx = Math.sign(Math.round(to.x - from.x))
  const dy = Math.sign(Math.round(to.y - from.y))
  const dir = AXIS_DIRS[`${dx},${dy}`]
  if (dir === undefined) throw new RangeError('cell route leg is not axis aligned')
  return dir
}

export function unitOf(dir: Dir): Vec {
  return { x: dir === 0 ? 1 : dir === 4 ? -1 : 0, y: dir === 2 ? 1 : dir === 6 ? -1 : 0 }
}

export interface SkeletonOptions {
  /** Elementit, joita kulmiin saa käyttää. Oletus: kaikki `turn`-roolin elementit. */
  cornerElementIds?: string[]
  minRunMm?: number
}

function canAfford(element: ResolvedElement, ledger: Ledger): boolean {
  return Object.entries(element.pieceCounts).every(([id, count]) => ledger.available(id) >= count)
}

function reserve(element: ResolvedElement, ledger: Ledger): boolean {
  const taken: [string, number][] = []
  for (const [id, count] of Object.entries(element.pieceCounts)) {
    if (!ledger.take(id, count)) {
      for (const [usedId, usedCount] of taken) ledger.release(usedId, usedCount)
      return false
    }
    taken.push([id, count])
  }
  return true
}

export function turnElements(elements: ElementLibrary, allowed?: readonly string[]): ResolvedElement[] {
  const ids = allowed ?? elements.byRole('turn').map((element) => element.id)
  return ids
    .map((id) => elements.byId.get(id))
    .filter((element): element is ResolvedElement => element !== undefined && Math.abs(element.turnDeg) === 90)
}

/**
 * Valitsee kulmaelementit ja varaa niiden palat. Valinta on lopullinen ennen
 * suorien tasapainotusta, koska osuuksien pituudet riippuvat kulmien mitoista.
 */
function chooseCorners(
  turns: number[],
  legLengthsMm: number[],
  elements: ElementLibrary,
  ledger: Ledger,
  rng: Rng,
  options: SkeletonOptions,
): SkeletonCorner[] | null {
  const pool = turnElements(elements, options.cornerElementIds)
  if (pool.length === 0) return null

  const corners: SkeletonCorner[] = []
  for (let i = 0; i < turns.length; i += 1) {
    const affordable = pool.filter((element) => canAfford(element, ledger))
    if (affordable.length === 0) return null

    // Osuuden molemmat päät kuluttavat kulmaa, joten yksi kulma saa viedä
    // korkeintaan puolet kummastakin viereisestä osuudesta.
    const legIn = legLengthsMm[(i - 1 + legLengthsMm.length) % legLengthsMm.length]
    const legOut = legLengthsMm[i]
    const fitting = affordable.filter((element) => element.alongMm <= legIn / 2 && element.acrossMm <= legOut / 2)
    // Isoa sädettä suositaan, kun se mahtuu — ahdas kulma on varavaihtoehto.
    const pick = fitting.length > 0 ? fitting : affordable
    const chosen = rng.weighted(pick, pick.map((element) => element.alongMm + element.acrossMm))
    if (!reserve(chosen, ledger)) return null
    corners.push({ elementId: chosen.id, mirror: turns[i] < 0, alongMm: chosen.alongMm, acrossMm: chosen.acrossMm })
  }
  return corners
}

/**
 * Pyöristää suorat osuudet täytettäviin pituuksiin ja päivittää sulkeutumis-
 * jäännöksen. Virheen diffuusio: jokainen osuus pyöristetään siihen pituuteen,
 * joka vie kumulatiivisen summan lähimmäksi tavoitetta, joten pyöristysvirhe ei
 * kasaannu vaan jää viimeisen askeleen suuruiseksi.
 */
export function balanceRuns(skeleton: Skeleton, table: FillTable, minRunMm = 0): void {
  const count = skeleton.corners.length
  const exactRuns = skeleton.legLengthsMm.map(
    (length, i) => length - skeleton.corners[i].acrossMm - skeleton.corners[(i + 1) % count].alongMm,
  )

  for (const axis of ['x', 'y'] as const) {
    let target = 0
    let actual = 0
    for (let i = 0; i < count; i += 1) {
      const sign = unitOf(skeleton.legDirs[i])[axis]
      if (sign === 0) continue
      target += sign * exactRuns[i]
      const desired = sign * (target - actual)
      const value = nearestFillable(table, desired, minRunMm) ?? 0
      skeleton.runsMm[i] = value
      actual += sign * value
    }
    skeleton.residual[axis] = actual - target
  }

  const startUnit = unitOf(skeleton.startDir)
  skeleton.startPoint = {
    x: skeleton.cornerPoints[0].x - skeleton.corners[0].alongMm * startUnit.x,
    y: skeleton.cornerPoints[0].y - skeleton.corners[0].alongMm * startUnit.y,
  }
}

/**
 * Rakentaa rungon solureitistä. `ledger` on kopio, jolla kulmien palat varataan
 * kelpoisuustarkistusta varten; lopulliset varaukset tehdään materialisoinnissa.
 */
export function buildSkeleton(
  cycle: CellCycle,
  mask: CellMask,
  elements: ElementLibrary,
  table: FillTable,
  ledger: Ledger,
  rng: Rng,
  options: SkeletonOptions = {},
): Skeleton | null {
  const turns: number[] = []
  const cornerPoints: Vec[] = []
  for (let i = 0; i < cycle.cells.length; i += 1) {
    const turn = turnAt(cycle, i)
    if (turn !== 0) {
      turns.push(turn)
      cornerPoints.push(cellCenter(mask, cycle.cells[i].col, cycle.cells[i].row))
    }
  }
  if (cornerPoints.length < 4) return null

  const count = cornerPoints.length
  const legDirs: Dir[] = []
  const legLengthsMm: number[] = []
  for (let i = 0; i < count; i += 1) {
    const from = cornerPoints[i]
    const to = cornerPoints[(i + 1) % count]
    legDirs.push(legDirBetween(from, to))
    legLengthsMm.push(Math.hypot(to.x - from.x, to.y - from.y))
  }

  const corners = chooseCorners(turns, legLengthsMm, elements, ledger, rng, options)
  if (!corners) return null

  const skeleton: Skeleton = {
    startPoint: cornerPoints[0],
    startDir: normalizeDir(legDirs[count - 1]),
    corners,
    runsMm: new Array<number>(count).fill(0),
    cornerPoints,
    legDirs,
    legLengthsMm,
    inserts: {},
    fillSalts: Array.from({ length: count }, (_, i) => i + 1),
    residual: { x: 0, y: 0 },
  }
  balanceRuns(skeleton, table, options.minRunMm ?? 0)
  return skeleton
}

/** Sulkeutumisvirheen suuruus rungon perusteella (ennen materialisointia). */
export function skeletonGapMm(skeleton: Skeleton): number {
  return Math.hypot(skeleton.residual.x, skeleton.residual.y)
}

export function cloneSkeleton(skeleton: Skeleton): Skeleton {
  return {
    startPoint: { ...skeleton.startPoint },
    startDir: skeleton.startDir,
    corners: skeleton.corners.map((corner) => ({ ...corner })),
    runsMm: [...skeleton.runsMm],
    cornerPoints: skeleton.cornerPoints.map((point) => ({ ...point })),
    legDirs: [...skeleton.legDirs],
    legLengthsMm: [...skeleton.legLengthsMm],
    inserts: { ...skeleton.inserts },
    fillSalts: [...skeleton.fillSalts],
    residual: { ...skeleton.residual },
  }
}
