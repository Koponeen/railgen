import type { Ledger } from './inventory'
import type { PieceLibrary } from './library'
import type { ResolvedPiece } from './pieces'
import type { Rng } from './rng'
import { EPS_MM, MICRO_GRID_MM, toMicroUnits } from './units'

// Segmentin täyttö suorilla — Track Solver -taulukon idea (README luku 4).
// Taulukko johdetaan palakirjastosta eikä ole erillinen kovakoodattu data-
// tiedosto: suorien pituudet ovat jo dataa, joten uusi suora (esim. A3 tai
// kolmannen osapuolen pala) laajentaa taulukkoa automaattisesti.

/** Yhdistelmä mikrogridin yksikköinä, laskevassa järjestyksessä. */
export type FillCombo = readonly number[]

export interface FillTable {
  /** Käytettävissä olevat suorapituudet mikroyksikköinä, laskevassa järjestyksessä. */
  unitLengths: number[]
  maxUnits: number
  /** combos[u] = tavat täyttää u yksikköä. Tyhjä lista = ei täytettävissä. */
  combos: FillCombo[][]
}

export const DEFAULT_MAX_FILL_MM = 2160

/**
 * Rakentaa täyttötaulukon. Yhdistelmät ovat kanonisia (laskeva järjestys), joten
 * jokainen multijoukko esiintyy tasan kerran. Määrä rajataan per pituus, jotta
 * taulukko pysyy pienenä; karsinta on deterministinen (vähiten paloja ensin).
 */
export function buildFillTable(
  straightLengthsMm: readonly number[],
  maxUnits = DEFAULT_MAX_FILL_MM / MICRO_GRID_MM,
  maxCombosPerLength = 24,
): FillTable {
  const unitLengths = [...new Set(straightLengthsMm.map(toMicroUnits))].filter((u) => u > 0).sort((a, b) => b - a)
  const combos: FillCombo[][] = [[[]]]

  for (let units = 1; units <= maxUnits; units += 1) {
    const found: number[][] = []
    for (const length of unitLengths) {
      if (length > units) continue
      for (const sub of combos[units - length]) {
        // Kanoninen muoto: uusi pala on aina yhdistelmän suurin.
        if (sub.length > 0 && sub[0] > length) continue
        found.push([length, ...sub])
      }
    }
    found.sort((a, b) => a.length - b.length || compareCombos(a, b))
    combos.push(found.slice(0, maxCombosPerLength))
  }

  return { unitLengths, maxUnits, combos }
}

function compareCombos(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return b[i] - a[i]
  }
  return a.length - b.length
}

export function fillTableFor(library: PieceLibrary, maxUnits?: number): FillTable {
  return buildFillTable(
    library.straights().map((piece) => piece.straightLengthMm as number),
    maxUnits,
  )
}

/** Onko matka täytettävissä lainkaan (inventaariosta riippumatta)? */
export function isFillable(table: FillTable, distanceMm: number): boolean {
  const units = distanceMm / MICRO_GRID_MM
  if (Math.abs(units - Math.round(units)) * MICRO_GRID_MM > EPS_MM) return false
  const rounded = Math.round(units)
  if (rounded < 0 || rounded > table.maxUnits) return false
  return table.combos[rounded].length > 0
}

/** Kaikki täytettävissä olevat pituudet millimetreinä, nousevassa järjestyksessä. */
export function fillableLengths(table: FillTable): number[] {
  const lengths: number[] = []
  for (let units = 0; units <= table.maxUnits; units += 1) {
    if (table.combos[units].length > 0) lengths.push(units * MICRO_GRID_MM)
  }
  return lengths
}

/**
 * Lähin täytettävissä oleva pituus. `minMm` rajaa alarajan (osuus ei saa kutistua
 * negatiiviseksi); tasapelissä valitaan lyhyempi, jotta rata pysyy alueen sisällä.
 */
export function nearestFillable(table: FillTable, targetMm: number, minMm = 0): number | null {
  let best: number | null = null
  let bestDelta = Infinity
  for (let units = Math.max(0, Math.ceil(minMm / MICRO_GRID_MM)); units <= table.maxUnits; units += 1) {
    if (table.combos[units].length === 0) continue
    const lengthMm = units * MICRO_GRID_MM
    const delta = Math.abs(lengthMm - targetMm)
    if (delta < bestDelta - EPS_MM) {
      best = lengthMm
      bestDelta = delta
    }
    if (lengthMm > targetMm && delta > bestDelta) break
  }
  return best
}

export interface FillRequest {
  distanceMm: number
  /** Kolmannen osapuolen pala välissä: vähennä pituus ja täytä loput taulukosta. */
  preplacedMm?: number
  /** Suosi pitkiä paloja (vähemmän liitoksia = pienempi Vario-kuluma). */
  preferLongPieces?: boolean
  maxNodes?: number
}

/**
 * Etsii inventaarion rajoissa olevan täytön ja varaa palat kirjanpidosta.
 * Palauttaa palojen tunnukset asennusjärjestyksessä tai null, jos täyttöä ei
 * löydy — kutsuja hylkää yrityksen siististi.
 */
export function solveFill(
  library: PieceLibrary,
  ledger: Ledger,
  rng: Rng,
  request: FillRequest,
): string[] | null {
  const remainingMm = request.distanceMm - (request.preplacedMm ?? 0)
  if (Math.abs(remainingMm) <= EPS_MM) return []
  if (remainingMm < 0) return null

  let units: number
  try {
    units = toMicroUnits(remainingMm)
  } catch {
    return null
  }

  const candidates = library
    .straights()
    .filter((piece) => !piece.tags.includes('bridge-deck'))
    .map((piece) => ({ piece, units: toMicroUnits(piece.straightLengthMm as number) }))

  const budget = { nodes: request.maxNodes ?? 4000 }
  const chosen: string[] = []
  const found = search(units, candidates, ledger, rng, chosen, budget, request.preferLongPieces ?? true)
  if (!found) {
    for (const id of chosen) ledger.release(id)
    return null
  }
  return rng.shuffle(chosen)
}

function search(
  units: number,
  candidates: readonly { piece: ResolvedPiece; units: number }[],
  ledger: Ledger,
  rng: Rng,
  chosen: string[],
  budget: { nodes: number },
  preferLong: boolean,
): boolean {
  if (units === 0) return true
  if (budget.nodes <= 0) return false
  budget.nodes -= 1

  const usable = candidates.filter((c) => c.units <= units && ledger.available(c.piece.id) > 0)
  if (usable.length === 0) return false

  // Painotettu järjestys: pitkät palat ensin, mutta arvonta pitää tuloksen
  // vaihtelevana saman siemenen sisällä (README luku 4: "satunnaistettu valinta
  // ekvivalenssien sisällä").
  const pool = [...usable]
  while (pool.length > 0) {
    const weights = pool.map((c) => (preferLong ? c.units * c.units : 1))
    const picked = rng.weighted(pool, weights)
    pool.splice(pool.indexOf(picked), 1)

    if (!ledger.take(picked.piece.id)) continue
    chosen.push(picked.piece.id)
    if (search(units - picked.units, candidates, ledger, rng, chosen, budget, preferLong)) return true
    chosen.pop()
    ledger.release(picked.piece.id)
    if (budget.nodes <= 0) return false
  }

  return false
}
