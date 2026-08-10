import { unlimitedInventory, type Inventory } from '../core/inventory'
import { defaultLibrary, type PieceLibrary } from '../core/library'
import { entryFrame, exitFrame, type PlacedPiece, type ResolvedPiece } from '../core/pieces'
import type { FlexSettings, VarioSettings } from '../core/vario'
import type { Track } from '../gen/build'
import { areaBounds, buildMask, type AreaShape } from '../gen/mask'
import { assembleTrack } from './assemble'
import { swapPlacement } from './branch'
import { availableExcluding } from './replace'
import type { Section } from './section'

// "Vaihda toiseen" (README luku 6): palan napautus tarjoaa saman
// porttisignatuurin toteutukset. Lista ei ole koodissa vaan seuraa
// palakirjastosta: `library.substitutesFor` antaa korvausluokan, ja uusi pala
// dataan liittyy mukaan ilman koodimuutosta (README luku 8).
//
// Vaihto on muokkauksista kevyin: yksi pala vaihtuu toiseen, muu rata ei liiku
// lainkaan. Juuri siksi ehto on ankara — uuden palan on päädyttävä **täsmälleen
// samaan päätyporttiin**, ja sen etsii geometria eikä signatuurin lupaus.

export interface SwapOptions {
  area: AreaShape
  library?: PieceLibrary
  inventory?: Inventory
  vario?: VarioSettings
  flex?: FlexSettings
}

export interface SwapOption {
  /** Vaihdettava pala. */
  fromId: string
  /** Tilalle tuleva pala. */
  toId: string
  track: Track
  /** Vaihdetun palan indeksi uudella radalla — haamuesikatselu piirtää sen. */
  addedIndices: number[]
  added: Record<string, number>
  removed: Record<string, number>
  withinInventory: boolean
  cost: number
}

/** Kokoelman ulkopuolelta otettu pala on kelvollinen mutta kallis: se on ostettava. */
const SHORTAGE_COST = 500

/**
 * Palan vaihtoehdot: kaikki saman korvausluokan palat, jotka mahtuvat samaan
 * paikkaan. Alkuperäinen rata jää koskemattomaksi.
 */
export function swapOptions(track: Track, section: Section, options: SwapOptions): SwapOption[] {
  // Vaihto koskee yhtä palaa. Pidemmän osion vaihtoehdot ovat variaatiokuvioita
  // (`variations.ts`) — kokonaista osuutta ei vaihdeta yhteen palaan.
  if (section.indices.length !== 1) return []

  const library = options.library ?? defaultLibrary()
  const inventory = options.inventory ?? unlimitedInventory()
  const index = section.indices[0]
  const placed = track.pieces[index]
  const original = library.get(placed.pieceId)

  const entry = entryFrame(placed, original)
  const exit = exitFrame(placed, original)
  const available = availableExcluding(track, new Set([index]), inventory)
  const bounds = areaBounds(buildMask(options.area))
  const results: SwapOption[] = []

  for (const piece of library.substitutesFor(original.id)) {
    if (piece.tags.includes('unverified-geometry')) continue
    const swapped = swapPlacement(piece, entry, exit)
    if (!swapped) continue

    const pieces: PlacedPiece[] = [...track.pieces]
    pieces[index] = swapped
    const joints = track.joints.map(([a, b]) => [a, b] as [number, number])

    // Vaihto ei siirrä mitään, joten omaa päätyheittoa ei ole: liitokset ovat
    // samat kuin ennenkin ja niiden kuluma on jo koko radan raportissa.
    const assembled = assembleTrack(
      track,
      { pieces, joints, localJoints: [], gapMm: 0 },
      { library, inventory, vario: options.vario, flex: options.flex, bounds },
    )
    if (!assembled.track) continue

    const inStock = available.unlimited || (available.counts[piece.id] ?? 0) >= 1
    results.push({
      fromId: original.id,
      toId: piece.id,
      track: assembled.track,
      addedIndices: [index],
      added: { [piece.id]: 1 },
      removed: { [original.id]: 1 },
      withinInventory: inStock,
      cost: swapCost(piece) + (inStock ? 0 : SHORTAGE_COST),
    })
  }

  return results.sort((a, b) => a.cost - b.cost || a.toId.localeCompare(b.toId))
}

/**
 * Järjestyskustannus tageista, ei kovakoodatusta listasta: perus­pala ensin,
 * risteys sen jälkeen (se muuttaa radan luonnetta) ja harvinainen viimeisenä.
 * Sama sääntö kuin haarapalojen järjestyksessä.
 */
function swapCost(piece: ResolvedPiece): number {
  let cost = piece.tags.includes('basic') ? 0 : 60
  if (piece.tags.includes('tee') || piece.tags.includes('star') || piece.tags.includes('crossing')) cost += 200
  if (piece.tags.includes('rare') || piece.tags.includes('retired')) cost += 150
  return cost
}
