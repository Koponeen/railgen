import type { Rng } from '../core/rng'
import { CELL_MM } from '../core/units'
import type { CellMask } from './mask'

// Solureitti: suljettu silmukka solukossa (README luku 4 kohta 2) —
// "kehäkierto + satunnaiset sisäänpistot".
//
// Kierros aloitetaan satunnaisen suorakaiteen kehältä ja sitä muokataan
// työntämällä osa suorasta osuudesta sivuun. Molemmat operaatiot säilyttävät
// yksinkertaisen suljetun kierroksen, joten reitti ei voi rikkoutua.
//
// Osuuksien minimipituus on kaksi solua: 2 x E -kulma vie 202 mm sisään ja
// 202 mm ulos, joten sitä lyhyempi osuus ei mahduta kulmaa kummastakaan päästä.

export interface Cell {
  col: number
  row: number
}

export interface CellCycle {
  /** Järjestetty, 4-naapuruudessa kulkeva, itseään leikkaamaton suljettu kierros. */
  cells: Cell[]
}

/** Lyhin sallittu osuus soluina. Alle tämän kulmaelementit eivät mahdu. */
export const MIN_LEG_CELLS = 2

const NEIGHBOURS: readonly Cell[] = [
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: -1, row: 0 },
  { col: 0, row: -1 },
]

function key(cell: Cell): string {
  return `${cell.col},${cell.row}`
}

function same(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row
}

export interface RouteOptions {
  /** Montako sisäänpistoa yritetään. */
  indents?: number
  /** Kuinka syvälle sisäänpisto työntää (soluina). */
  indentDepth?: number
  /** Estä kierrosta koskettamasta itseään (pitää käytävät erillään). */
  avoidPinch?: boolean
  /** Pisin kehä, johon inventaarion rata riittää. */
  maxPerimeterMm?: number
  /** Suurin kulmamäärä, johon inventaarion kaaret riittävät. */
  maxCorners?: number
}

/** Yksi sisäänpisto lisää neljä kulmaa kehäkierroksen neljän lisäksi. */
const CORNERS_PER_INDENT = 4

/** Suorakaiteen kehäkierros myötäpäivään, jos kaikki kehäsolut ovat maskissa. */
export function perimeterRing(mask: CellMask, col0: number, row0: number, col1: number, row1: number): CellCycle | null {
  if (col1 - col0 < MIN_LEG_CELLS || row1 - row0 < MIN_LEG_CELLS) return null
  const cells: Cell[] = []
  for (let col = col0; col <= col1; col += 1) cells.push({ col, row: row0 })
  for (let row = row0 + 1; row <= row1; row += 1) cells.push({ col: col1, row })
  for (let col = col1 - 1; col >= col0; col -= 1) cells.push({ col, row: row1 })
  for (let row = row1 - 1; row > row0; row -= 1) cells.push({ col: col0, row })
  if (cells.some((cell) => !mask.has(cell.col, cell.row))) return null
  return { cells }
}

/** Kaikki maskiin mahtuvat kehäsuorakaiteet, suurimmat ensin. */
function candidateRings(mask: CellMask): { col0: number; row0: number; col1: number; row1: number }[] {
  const rings: { col0: number; row0: number; col1: number; row1: number }[] = []
  for (let row0 = 0; row0 < mask.rows; row0 += 1) {
    for (let col0 = 0; col0 < mask.cols; col0 += 1) {
      for (let row1 = row0 + MIN_LEG_CELLS; row1 < mask.rows; row1 += 1) {
        for (let col1 = col0 + MIN_LEG_CELLS; col1 < mask.cols; col1 += 1) {
          if (perimeterRing(mask, col0, row0, col1, row1)) rings.push({ col0, row0, col1, row1 })
        }
      }
    }
  }
  return rings
}

/** Kehän pituus millimetreinä kulmasolujen keskipisteitä pitkin. */
function ringPerimeterMm(ring: { col0: number; row0: number; col1: number; row1: number }): number {
  return 2 * (ring.col1 - ring.col0 + (ring.row1 - ring.row0)) * CELL_MM
}

export function growCycle(mask: CellMask, rng: Rng, options: RouteOptions = {}): CellCycle | null {
  const all = candidateRings(mask)
  if (all.length === 0) return null

  // Inventaario rajaa radan pituuden: liian iso kehä ei olisi rakennettavissa.
  const budgetMm = options.maxPerimeterMm ?? Infinity
  const affordable = all.filter((ring) => ringPerimeterMm(ring) <= budgetMm)
  const rings = affordable.length > 0 ? affordable : [smallestRing(all)]

  // Painotetaan isoja kehiä: pieni rata keskellä olohuoneen lattiaa on tylsä.
  const areas = rings.map((ring) => (ring.col1 - ring.col0) * (ring.row1 - ring.row0))
  const maxArea = Math.max(...areas)
  const ring = rng.weighted(rings, areas.map((area) => (area / maxArea) ** 3))
  const cycle = perimeterRing(mask, ring.col0, ring.row0, ring.col1, ring.row1)
  if (!cycle) return null

  // Sisäänpistot maksavat sekä pituutta että kulmia; molemmat rajataan.
  const cornerRoom = Math.floor((((options.maxCorners ?? Infinity) - 4) || 0) / CORNERS_PER_INDENT)
  const lengthRoom = ringPerimeterMm(ring) * 1.6 <= budgetMm ? 2 : 0
  const allowed = Math.max(0, Math.min(cornerRoom, lengthRoom, 2))
  const indents = options.indents ?? rng.int(allowed + 1)
  const depth = options.indentDepth ?? MIN_LEG_CELLS
  for (let i = 0; i < indents; i += 1) {
    indent(cycle, mask, rng, depth, options.avoidPinch ?? true)
  }

  return cycle
}

function smallestRing(rings: { col0: number; row0: number; col1: number; row1: number }[]) {
  return rings.reduce((best, ring) => (ringPerimeterMm(ring) < ringPerimeterMm(best) ? ring : best))
}

/** Solujen indeksit, joissa reitti kääntyy. */
export function cornerIndices(cycle: CellCycle): number[] {
  const indices: number[] = []
  for (let i = 0; i < cycle.cells.length; i += 1) {
    if (turnAt(cycle, i) !== 0) indices.push(i)
  }
  return indices
}

/**
 * Sisäänpisto: valitaan suoran osuuden keskeltä pätkä ja työnnetään se sivuun.
 * Reunoille jätetään vähintään `MIN_LEG_CELLS` solua, jotta uudet kulmat
 * mahtuvat molempiin päihin.
 */
function indent(cycle: CellCycle, mask: CellMask, rng: Rng, depth: number, avoidPinch: boolean): boolean {
  const corners = cornerIndices(cycle)
  if (corners.length < 4) return false

  const used = new Set(cycle.cells.map(key))
  const legs = rng.shuffle(corners.map((start, i) => ({ start, end: corners[(i + 1) % corners.length] })))

  for (const leg of legs) {
    const length = (leg.end - leg.start + cycle.cells.length) % cycle.cells.length
    // Osuus tarvitsee marginaalit molempiin päihin ja työnnettävän pätkän väliin.
    if (length < MIN_LEG_CELLS * 3) continue

    const at = (offset: number) => cycle.cells[(leg.start + offset) % cycle.cells.length]
    const direction = { col: at(1).col - at(0).col, row: at(1).row - at(0).row }

    const maxSpan = length - MIN_LEG_CELLS * 2
    for (const span of rng.shuffle(rangeOf(MIN_LEG_CELLS, maxSpan))) {
      for (const from of rng.shuffle(rangeOf(MIN_LEG_CELLS, length - MIN_LEG_CELLS - span))) {
        for (const side of rng.shuffle([1, -1])) {
          const offset = { col: -direction.row * side * depth, row: direction.col * side * depth }
          const step = { col: Math.sign(offset.col), row: Math.sign(offset.row) }

          const inserted: Cell[] = []
          for (let d = 1; d <= depth; d += 1) inserted.push(shift(at(from), step, d))
          for (let s = 1; s <= span; s += 1) inserted.push(shift(at(from + s), offset, 1))
          for (let d = depth - 1; d >= 1; d -= 1) inserted.push(shift(at(from + span), step, d))

          const replaced = rangeOf(from + 1, from + span - 1).map((offsetIndex) => at(offsetIndex))
          const remaining = new Set(used)
          for (const cell of replaced) remaining.delete(key(cell))
          // Pätkän päät jäävät kierrokseen ja ovat uusien solujen lailliset naapurit.
          const anchors: [Cell, Cell] = [at(from), at(from + span)]

          if (inserted.some((cell) => !mask.has(cell.col, cell.row) || remaining.has(key(cell)))) continue
          if (avoidPinch && inserted.some((cell, index) => touches(cell, remaining, inserted, index, anchors))) continue

          const head = (leg.start + from + 1) % cycle.cells.length
          spliceCycle(cycle, head, span - 1, inserted)
          return true
        }
      }
    }
  }
  return false
}

function shift(cell: Cell, step: Cell, times: number): Cell {
  return { col: cell.col + step.col * times, row: cell.row + step.row * times }
}

function rangeOf(from: number, to: number): number[] {
  const values: number[] = []
  for (let i = from; i <= to; i += 1) values.push(i)
  return values
}

/** Koskettaako uusi solu kierrosta muualta kuin omista naapureistaan? */
function touches(
  cell: Cell,
  remaining: ReadonlySet<string>,
  inserted: readonly Cell[],
  index: number,
  anchors: readonly [Cell, Cell],
): boolean {
  const allowed: Cell[] = []
  if (index > 0) allowed.push(inserted[index - 1])
  if (index < inserted.length - 1) allowed.push(inserted[index + 1])
  if (index === 0) allowed.push(anchors[0])
  if (index === inserted.length - 1) allowed.push(anchors[1])

  for (const offset of NEIGHBOURS) {
    const neighbour = { col: cell.col + offset.col, row: cell.row + offset.row }
    if (allowed.some((other) => same(other, neighbour))) continue
    if (remaining.has(key(neighbour))) return true
  }
  return false
}

/** Korvaa `count` solua indeksistä `start` (kierrosta pitkin) uusilla soluilla. */
function spliceCycle(cycle: CellCycle, start: number, count: number, inserted: Cell[]): void {
  const cells = cycle.cells
  if (start + count <= cells.length) {
    cells.splice(start, count, ...inserted)
    return
  }
  // Katkos kierroksen lopun yli: poistetaan kahdessa osassa.
  const tail = cells.length - start
  cells.splice(start, tail, ...inserted)
  cells.splice(0, count - tail)
}

/** Reitin kääntymissuunta solussa: 0 = suoraan, +1 = oikealle, -1 = vasemmalle. */
export function turnAt(cycle: CellCycle, index: number): -1 | 0 | 1 {
  const count = cycle.cells.length
  const previous = cycle.cells[(index - 1 + count) % count]
  const current = cycle.cells[index]
  const next = cycle.cells[(index + 1) % count]
  const inDir = { col: current.col - previous.col, row: current.row - previous.row }
  const outDir = { col: next.col - current.col, row: next.row - current.row }
  const cross = inDir.col * outDir.row - inDir.row * outDir.col
  return cross === 0 ? 0 : cross > 0 ? 1 : -1
}

/** Tarkistaa, että kierros on kelvollinen: 4-naapuruus, ei toistoja, sulkeutuu. */
export function isValidCycle(cycle: CellCycle): boolean {
  const cells = cycle.cells
  if (cells.length < 4) return false
  const seen = new Set<string>()
  for (let i = 0; i < cells.length; i += 1) {
    if (seen.has(key(cells[i]))) return false
    seen.add(key(cells[i]))
    const next = cells[(i + 1) % cells.length]
    if (Math.abs(next.col - cells[i].col) + Math.abs(next.row - cells[i].row) !== 1) return false
  }
  return true
}

/** Lyhin osuus soluina — kulmaelementtien mahtumisen esitarkistus. */
export function shortestLegCells(cycle: CellCycle): number {
  const corners = cornerIndices(cycle)
  if (corners.length < 2) return cycle.cells.length
  let shortest = Infinity
  for (let i = 0; i < corners.length; i += 1) {
    const length = (corners[(i + 1) % corners.length] - corners[i] + cycle.cells.length) % cycle.cells.length
    shortest = Math.min(shortest, length)
  }
  return shortest
}
