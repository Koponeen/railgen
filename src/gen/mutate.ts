import { isFillable, type FillTable } from '../core/fill'
import type { Rng } from '../core/rng'
import { MICRO_GRID_MM } from '../core/units'
import type { ElementLibrary } from './elements'
import { balanceRuns, cloneSkeleton, turnElements, unitOf, type Skeleton } from './skeleton'

// Mutaatiot muokkaavat runkoa, ei valmiita paloja. Jokainen mutaatio tuottaa
// uuden rungon tai palauttaa syyn, miksi se ei sovellu; kutsuja materialisoi
// tuloksen ja hylkää sen, jos rata ei kelpaa. Runko pysyy aina ehjänä
// (README luku 4 kohta 4).

export interface MutationContext {
  elements: ElementLibrary
  table: FillTable
}

export type MutationResult = { ok: true; skeleton: Skeleton } | { ok: false; reason: string }

export interface Mutation {
  id: string
  apply(skeleton: Skeleton, context: MutationContext, rng: Rng): MutationResult
}

function rejected(reason: string): MutationResult {
  return { ok: false, reason }
}

/** Vaihtaa yhden kulman toiseen saman signatuurin toteutukseen. */
const swapCorner: Mutation = {
  id: 'swap-corner',
  apply(skeleton, context, rng) {
    const pool = turnElements(context.elements)
    if (pool.length < 2) return rejected('no-alternative-corner')

    const index = rng.int(skeleton.corners.length)
    const current = skeleton.corners[index]
    const alternatives = pool.filter((element) => element.id !== current.elementId)
    if (alternatives.length === 0) return rejected('no-alternative-corner')

    const chosen = rng.pick(alternatives)
    const next = cloneSkeleton(skeleton)
    next.corners[index] = { ...current, elementId: chosen.id, alongMm: chosen.alongMm, acrossMm: chosen.acrossMm }
    balanceRuns(next, context.table)
    return { ok: true, skeleton: next }
  },
}

/**
 * Siirtää 18 mm pituutta osuudelta toiselle sulkeutumista rikkomatta: samaan
 * suuntaan kulkevilta osuuksilta vastakkain, vastakkaisilta samaan suuntaan.
 */
const shiftLength: Mutation = {
  id: 'shift-length',
  apply(skeleton, context, rng) {
    const count = skeleton.runsMm.length
    for (const axis of rng.shuffle(['x', 'y'] as const)) {
      const legs = rng.shuffle(
        Array.from({ length: count }, (_, i) => i).filter((i) => unitOf(skeleton.legDirs[i])[axis] !== 0),
      )
      for (let a = 0; a < legs.length; a += 1) {
        for (let b = 0; b < legs.length; b += 1) {
          if (a === b) continue
          const signA = unitOf(skeleton.legDirs[legs[a]])[axis]
          const signB = unitOf(skeleton.legDirs[legs[b]])[axis]
          const deltaB = signA === signB ? -MICRO_GRID_MM : MICRO_GRID_MM
          const lengthA = skeleton.runsMm[legs[a]] + MICRO_GRID_MM
          const lengthB = skeleton.runsMm[legs[b]] + deltaB
          if (lengthB < 0) continue
          if (!isFillable(context.table, lengthA) || !isFillable(context.table, lengthB)) continue

          const next = cloneSkeleton(skeleton)
          next.runsMm[legs[a]] = lengthA
          next.runsMm[legs[b]] = lengthB
          return { ok: true, skeleton: next }
        }
      }
    }
    return rejected('no-shiftable-pair')
  },
}

/** Arpoo yhden osuuden täytön uudelleen samasta ekvivalenssiluokasta. */
const refillRun: Mutation = {
  id: 'refill-run',
  apply(skeleton, _context, rng) {
    const candidates = skeleton.runsMm.map((_, i) => i).filter((i) => skeleton.runsMm[i] > 0)
    if (candidates.length === 0) return rejected('no-run-to-refill')
    const next = cloneSkeleton(skeleton)
    const index = rng.pick(candidates)
    next.fillSalts[index] = rng.nextUint32()
    return { ok: true, skeleton: next }
  },
}

/**
 * Upottaa elementin suoralle osuudelle. Elementin pääreitti kulkee osuuden
 * suuntaisesti ja on yhtä pitkä kuin korvaamansa suora, joten silmukan
 * geometria ei muutu lainkaan — sulkeutumista ei tarvitse laskea uudelleen.
 *
 * `hill` = ramppi ylös, kansi, ramppi alas.
 * `siding` = vaihde + pätkä + puskuri (README luku 6).
 */
function insertOnRun(id: string, role: 'hill' | 'siding'): Mutation {
  return {
    id,
    apply(skeleton, context, rng) {
      const candidates = context.elements.byRole(role)
      if (candidates.length === 0) return rejected(`no-${role}-element`)

      const free = skeleton.runsMm.map((_, i) => i).filter((i) => skeleton.inserts[i] === undefined)
      for (const index of rng.shuffle(free)) {
        for (const element of rng.shuffle(candidates)) {
          const remaining = skeleton.runsMm[index] - element.alongMm
          if (remaining < 0 || !isFillable(context.table, remaining)) continue
          const next = cloneSkeleton(skeleton)
          next.inserts[index] = element.id
          return { ok: true, skeleton: next }
        }
      }
      return rejected('no-run-long-enough')
    },
  }
}

/**
 * Mutaatiot, jotka vaativat haaroittavia tai risteäviä paloja. Palakirjastossa
 * ei vielä ole niitä (ks. docs/PIECE_LIBRARY.md), joten nämä hylkäävät itsensä
 * siististi eivätkä koskaan riko runkoa. Kun palat lisätään dataan, nämä
 * alkavat toimia ilman koodimuutosta tähän tiedostoon.
 */
function requiresRole(id: string, role: 'branch' | 'crossing'): Mutation {
  return {
    id,
    apply(_skeleton, context) {
      if (context.elements.byRole(role).length === 0) return rejected(`no-${role}-element`)
      return rejected(`${id}-not-implemented`)
    },
  }
}

export const MUTATIONS: Mutation[] = [
  swapCorner,
  shiftLength,
  refillRun,
  insertOnRun('hill', 'hill'),
  insertOnRun('siding', 'siding'),
  requiresRole('shortcut', 'branch'),
  requiresRole('extra-loop', 'branch'),
  requiresRole('overpass', 'crossing'),
  requiresRole('x-crossing', 'crossing'),
]

export function mutationById(id: string): Mutation | undefined {
  return MUTATIONS.find((mutation) => mutation.id === id)
}
