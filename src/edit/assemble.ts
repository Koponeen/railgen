import { shortagesAgainst, type Inventory } from '../core/inventory'
import type { PieceLibrary } from '../core/library'
import type { BBox } from '../core/path'
import type { PlacedPiece } from '../core/pieces'
import { evaluateClosure, type FlexSettings, type Joint, type VarioSettings } from '../core/vario'
import { summariseTrack, type Track } from '../gen/build'

// Muokkauksen viimeinen vaihe on joka kerta sama: valmis palajoukko tarkistetaan
// ja siitä kootaan rata. Korvaus, haara, vaihto, poisto ja autosolver eroavat
// toisistaan siinä *mitä* paloja ne tuottavat — eivät siinä, mitä valmiilta
// radalta vaaditaan.
//
// Vaatimukset ovat kolme, ja kaikki kolme ovat hylkäysperusteita:
//
// 1. Muutoksen oma päätyheitto mahtuu **muutoksen omille liitoksille**. Heitto on
//    syntynyt siinä ja sen on mahduttava siihen.
// 2. Yksikään liitos ei ylitä turvakattoa.
// 3. Rataan ei synny uutta törmäystä. Vertailu alkuperäiseen eikä nollaan, koska
//    monitasoisessa radassa laskuri voi olla valmiiksi nollaa suurempi.
//
// Epäonnistuminen palauttaa vain syyn: alkuperäinen rata jää koskemattomaksi
// (CLAUDE.md — rata on joka välivaiheessa ehjä).

export type AssembleReason = 'ok' | 'ends-beyond-budget' | 'joint-over-safety-cap' | 'self-collision'

export interface AssembleOptions {
  library: PieceLibrary
  inventory: Inventory
  vario?: VarioSettings
  flex?: FlexSettings
  /** Lattia-alueen äärimitat: `summariseTrack` kertoo niistä mahtuuko rata. */
  bounds: BBox
}

export interface AssembleInput {
  pieces: PlacedPiece[]
  joints: [number, number][]
  /** Muutoksen omat liitokset päätyliitoksineen: päätyheitto kohdistuu näihin. */
  localJoints: readonly [number, number][]
  /** Päätyheitto, jonka Vario nielee. */
  gapMm: number
}

export interface Assembled {
  track: Track | null
  reason: AssembleReason
}

/** Liitosten joustokertoimet: liitos joustaa kahden palansa keskiarvon verran. */
export function jointsOf(
  pieces: readonly PlacedPiece[],
  joints: readonly [number, number][],
  library: PieceLibrary,
): Joint[] {
  return joints.map(([a, b]) => ({
    varioFactor: (library.get(pieces[a].pieceId).varioFactor + library.get(pieces[b].pieceId).varioFactor) / 2,
  }))
}

export function countUsage(pieces: readonly PlacedPiece[]): Record<string, number> {
  const usage: Record<string, number> = {}
  for (const placed of pieces) usage[placed.pieceId] = (usage[placed.pieceId] ?? 0) + 1
  return usage
}

/**
 * Tarkistaa muutoksen ja kokoaa siitä radan. Palauttaa radan vain jos muutos
 * kestää kaikki kolme ehtoa; muuten pelkän syyn.
 */
export function assembleTrack(base: Track, next: AssembleInput, options: AssembleOptions): Assembled {
  const { library } = options
  const local = evaluateClosure(jointsOf(next.pieces, next.localJoints, library), { gapMm: next.gapMm, angleDeg: 0 }, {
    settings: options.vario,
    flex: options.flex,
  })
  if (!local.withinBudget) return { track: null, reason: 'ends-beyond-budget' }
  if (!local.withinCaps) return { track: null, reason: 'joint-over-safety-cap' }

  const usage = countUsage(next.pieces)
  const track = summariseTrack(
    {
      pieces: next.pieces,
      joints: next.joints,
      // Silmukan alkuperäinen sauma on yhä olemassa ja kuluttaa oman osuutensa
      // Variosta; muutos lisää siihen omansa. Kireysprosentti kertoo summan.
      closure: evaluateClosure(
        jointsOf(next.pieces, next.joints, library),
        { gapMm: base.closure.error.gapMm + next.gapMm, angleDeg: base.closure.error.angleDeg },
        { settings: options.vario, flex: options.flex },
      ),
      usage,
      shortages: shortagesAgainst(usage, options.inventory),
      areaBounds: options.bounds,
    },
    library,
  )

  if (track.collisions > base.collisions) return { track: null, reason: 'self-collision' }
  return { track, reason: 'ok' }
}
