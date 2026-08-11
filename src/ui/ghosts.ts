import type { PieceLibrary } from '../core/library'
import { samplePath } from '../core/path'
import { placedSegments, type PlacedPiece } from '../core/pieces'
import { TRACK_WIDTH_MM } from '../core/units'
import type { Ghost, Point } from './state'

// Kumpi haamu sormen alla oli? Kysymys näyttää DOM-kysymykseltä muttei ole
// sitä: haamut piirretään päällekkäin samaan kohtaan rataa, joten
// `elementFromPoint` vastaa aina **viimeksi piirretty** eikä sitä, johon sormi
// osoitti. Juuri siitä syntyi vika, jossa nimilappu lupasi `T`:n mutta radalle
// tuli `L`/`M` (docs/BRANCHING.md): käyttäjä napautti `T`:n haamua ja sai sen,
// joka sattui olemaan päällimmäisenä.
//
// Vastaus mitataan siis geometriasta eikä piirtojärjestyksestä, ja mitataan
// siitä osasta, jonka perusteella vaihtoehdot ylipäätään eroavat toisistaan.

/** Numerolappu on tähtäyspiste: sen sisään osunut napautus on aina sen lappu. */
const TAG_REACH_MM = 60

/**
 * Näin kaukaa haamun voi vielä napauttaa — sama mitta kuin osumapolun
 * puolileveys (`ghost-hit`, 90 mm), jotta sormella osuu ilman tähtäilyä.
 */
export const GHOST_REACH_MM = 45

/** Keskilinja näytteistetään tällä tiheydellä etäisyysmittausta varten. */
const SAMPLE_STEP_MM = 15

/**
 * Kahden haamun ero on luettava napautuksesta. Jos ne ovat sormen alla yhtä
 * lähellä, napautus ei kerro kummasta on kyse — ja arvaaminen on juuri se vika,
 * joka tässä korjataan. Selvä ero on vähintään laudan levyinen.
 */
const DISTINCT_MARGIN_MM = TRACK_WIDTH_MM

/**
 * Mihin napautus osui kartalla, kun siellä on kysymys.
 *
 * - `option` — käyttäjä valitsi tämän vaihtoehdon.
 * - `ambiguous` — sormi osui haamuun, mutta sen jaettuun osaan: kaikki
 *   vaihtoehdot kulkevat siitä, joten napautus ei ole valinta. Kysymys jää
 *   auki eikä siihen vastata arvaamalla.
 * - `miss` — napautus meni haamujen ohi, eli kysymys perutaan.
 */
export type GhostHit = { kind: 'option'; index: number } | { kind: 'ambiguous' } | { kind: 'miss' }

function placementKey(placed: PlacedPiece): string {
  const { x, y, rot, mirror, level } = placed.placement
  return `${placed.pieceId}|${x.toFixed(1)}|${y.toFixed(1)}|${rot}|${mirror}|${level}`
}

/**
 * Se osa haamusta, joka erottaa sen muista. Vaihtoehdot lähtevät samasta
 * kohdasta ja täyttävät saman osuuden uudelleen, joten iso osa niiden paloista
 * on täsmälleen päällekkäin — sellaisen palan napautus ei tarkoita yhtä
 * vaihtoehtoa toisen sijaan, ja siksi valinta luetaan siitä mikä on eri.
 */
export function distinctPieces(ghosts: readonly Ghost[], index: number): readonly PlacedPiece[] {
  const others = new Set<string>()
  ghosts.forEach((ghost, other) => {
    if (other === index) return
    for (const placed of ghost.pieces) others.add(placementKey(placed))
  })

  const own = ghosts[index].pieces.filter((placed) => !others.has(placementKey(placed)))
  // Kokonaan toisen sisään jäävä haamu on harvinainen mutta mahdollinen;
  // silloin koko haamu on sen oma paras vastaus.
  return own.length > 0 ? own : ghosts[index].pieces
}

/** Lyhin etäisyys pisteestä palajoukon keskilinjalle. */
function distanceTo(pieces: readonly PlacedPiece[], library: PieceLibrary, point: Point): number {
  let best = Infinity
  for (const placed of pieces) {
    for (const sample of samplePath(placedSegments(placed, library.get(placed.pieceId)), SAMPLE_STEP_MM)) {
      const distance = Math.hypot(sample.x - point.x, sample.y - point.y)
      if (distance < best) best = distance
    }
  }
  return best
}

/**
 * Mitä vaihtoehtoa napautus tarkoitti. Järjestys on sama kuin käyttäjän
 * katseella: ensin numerolappu, sitten se osa haamusta joka erottaa sen muista.
 */
export function ghostAt(
  ghosts: readonly Ghost[],
  library: PieceLibrary,
  point: Point,
  reachMm: number = GHOST_REACH_MM,
): GhostHit {
  if (ghosts.length === 0) return { kind: 'miss' }

  // Lappu on se mihin sormi tähtää, ja se piirretään kaikkien haamujen päälle.
  let tagIndex: number | null = null
  let tagDistance = TAG_REACH_MM
  ghosts.forEach((ghost, index) => {
    const distance = Math.hypot(ghost.tag.x - point.x, ghost.tag.y - point.y)
    if (distance <= tagDistance) {
      tagDistance = distance
      tagIndex = index
    }
  })
  if (tagIndex !== null) return { kind: 'option', index: tagIndex }

  const distinct = ghosts.map((_, index) => distanceTo(distinctPieces(ghosts, index), library, point))
  let best = 0
  for (let index = 1; index < distinct.length; index += 1) {
    if (distinct[index] < distinct[best]) best = index
  }

  if (distinct[best] <= reachMm) {
    const runnerUp = distinct.filter((_, index) => index !== best).sort((a, b) => a - b)[0] ?? Infinity
    if (runnerUp - distinct[best] >= DISTINCT_MARGIN_MM) return { kind: 'option', index: best }
    return { kind: 'ambiguous' }
  }

  // Erottava osa on kaukana, mutta sormi voi silti olla haamun päällä — siinä
  // osassa, joka on kaikilla sama. Kysymys jää silloin auki: napautus ei ollut
  // valinta muttei myöskään ohi.
  const anyGhost = ghosts.some((ghost) => distanceTo(ghost.pieces, library, point) <= reachMm)
  return anyGhost ? { kind: 'ambiguous' } : { kind: 'miss' }
}
