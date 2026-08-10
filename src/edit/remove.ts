import { inventoryFillTable } from '../core/fill'
import { unlimitedInventory, type Inventory } from '../core/inventory'
import { defaultLibrary, type PieceLibrary } from '../core/library'
import { placedFootprint, type Frame, type PlacedPiece } from '../core/pieces'
import { polygonBBox, unionBBox } from '../core/path'
import type { FlexSettings, VarioSettings } from '../core/vario'
import { countCollisions, type Track } from '../gen/build'
import { areaBounds, buildMask, type AreaShape } from '../gen/mask'
import { assembleTrack, countUsage, type AssembleReason } from './assemble'
import { insertIntoRun } from './branch'
import type { Section } from './section'

// Poisto (README luku 6): "Poisto jättää aukkomerkin: täytä automaattisesti
// (Solver) / piirrä tilalle / kumoa."
//
// Radan **keskeltä** poistaminen on siis välitila eikä lopputulos: keskelle jää
// kaksi avointa päätyporttia ja mitta niiden välillä, ja käyttäjä ratkaisee
// aukon. Kaikki tavat lähtevät alkuperäisestä radasta — muokattavaa
// "rikkinäistä" välitilaa ei ole olemassa (CLAUDE.md).
//
// Radan **päästä** poistaminen on eri asia: siellä ei ole aukkoa vaan kiskonpää,
// joka vain siirtyy taaksepäin. Sitä ei ole mitään syytä kysyä, joten poisto
// päästä toteutuu suoraan. Ilman tätä eroa piirretyn haaran päätä ei saanut
// poistettua lainkaan: koodi luki vapaan pään porttipariksi, valitti aukosta ja
// tarjosi vain sen täyttämistä takaisin.

export type RemoveReason = 'ok' | 'section-not-removable'

/** Aukko radassa: kaksi avointa päätyporttia ja se mikä niiden välistä lähti. */
export interface GapMarker {
  start: Frame
  end: Frame
  /** Aukon nimellismitta: poistettujen palojen keskilinjasumma. */
  lengthMm: number
  /** Purkamisesta vapautuvat palat (README luku 6). */
  freed: Record<string, number>
}

export interface RemoveResult {
  /**
   * Rata ilman osiota. Radan keskeltä poistettaessa tämä on **esikatselu**:
   * aukko on merkitty erikseen eikä radan päitä ole liitetty toisiinsa. Päästä
   * poistettaessa se on valmis rata sellaisenaan.
   */
  track: Track | null
  /**
   * Aukko radan keskellä, tai null jos poisto osui radan päähän. Null tarkoittaa
   * että kysyttävää ei ole: `track` on valmis vastaus.
   */
  gap: GapMarker | null
  reason: RemoveReason
}

export interface RemoveOptions {
  area: AreaShape
  library?: PieceLibrary
  inventory?: Inventory
  vario?: VarioSettings
  flex?: FlexSettings
}

export type FillGapReason = AssembleReason | 'section-not-removable' | 'no-fill'

export interface FillGapResult {
  track: Track | null
  reason: FillGapReason
  pieceCount: number
  added: Record<string, number>
  removed: Record<string, number>
  withinInventory: boolean
}

/**
 * Purkaa osion ja jättää aukkomerkin. Osion päätyportit säilyvät sellaisinaan:
 * ne ovat aukon reunat ja samalla se tehtävänanto, jonka täyttö tai piirto saa.
 */
export function removeSection(track: Track, section: Section, options: RemoveOptions): RemoveResult {
  // Poiston ehto on löysempi kuin korvauksen: keskeltä lähtevä haara ei estä
  // poistoa, se vain jää lattialle irralleen. Palojen on voitava lähteä radalta
  // aina — muuten poistonappi ei poista mitään.
  if (!section.removable) return { track: null, gap: null, reason: 'section-not-removable' }

  const library = options.library ?? defaultLibrary()
  const inside = new Set(section.indices)
  const remap = new Map<number, number>()
  const pieces: PlacedPiece[] = []

  track.pieces.forEach((placed, index) => {
    if (inside.has(index)) return
    remap.set(index, pieces.length)
    pieces.push(placed)
  })

  const joints: [number, number][] = []
  for (const [a, b] of track.joints) {
    if (inside.has(a) || inside.has(b)) continue
    joints.push([remap.get(a) as number, remap.get(b) as number])
  }

  const freed: Record<string, number> = {}
  let lengthMm = 0
  for (const index of section.indices) {
    const placed = track.pieces[index]
    freed[placed.pieceId] = (freed[placed.pieceId] ?? 0) + 1
    lengthMm += library.get(placed.pieceId).lengthMm
  }

  const usage = countUsage(pieces)
  const bounds = areaBounds(buildMask(options.area))
  const footprints = pieces.map((placed) => placedFootprint(placed, library.get(placed.pieceId)))
  const bbox = unionBBox(footprints.flat().map(polygonBBox))

  return {
    track: {
      pieces,
      joints,
      lengthMm: pieces.reduce((sum, placed) => sum + library.get(placed.pieceId).lengthMm, 0),
      bbox,
      // Sauma on yhä siellä missä ennenkin: poisto ei kosketa sitä, vaan avaa
      // radan toisaalta. Kireysprosentti kertoo siis edelleen sauman kuluman,
      // ja aukko näkyy aukkomerkkinä eikä lukuna.
      closure: track.closure,
      usage,
      shortages: track.shortages,
      maxLevel: pieces.reduce(
        (max, placed) => Math.max(max, placed.placement.level + library.get(placed.pieceId).levelDelta),
        0,
      ),
      fitsArea: bbox.minX >= bounds.minX && bbox.minY >= bounds.minY && bbox.maxX <= bounds.maxX && bbox.maxY <= bounds.maxY,
      collisions: countCollisions(pieces, library, joints),
    },
    // Osio radan päässä ei jätä aukkoa vaan lyhentää rataa: sen toisella
    // puolella ei ole mitään mihin liittyä.
    gap: atFreeEnd(section) ? null : { start: section.start, end: section.end, lengthMm, freed },
    reason: 'ok',
  }
}

/** Onko osio radan päässä? Silloin sen toisella puolella ei ole naapuria. */
export function atFreeEnd(section: Section): boolean {
  return section.before === null || section.after === null
}

/**
 * Täyttää aukon automaattisesti (README luku 6: "täytä automaattisesti
 * (Solver)"). Täyttö on sama Track Solver -haku kuin generoinnissa: pelkkiä
 * suoria päätyportista päätyporttiin, kokoelman rajoissa ja vapautuneet palat
 * mukaan lukien.
 *
 * Aukon päiden on siis oltava samalla linjalla. Mutkan yli venytetyn valinnan
 * jälkeen ne eivät ole, ja silloin Solver sanoo sen suoraan: aukon voi täyttää
 * piirtämällä, mutta suorilla sitä ei täytetä.
 */
export function fillGap(track: Track, section: Section, options: RemoveOptions): FillGapResult {
  if (!section.replaceable) return failure('section-not-removable')

  const library = options.library ?? defaultLibrary()
  const inventory = options.inventory ?? unlimitedInventory()
  const bounds = areaBounds(buildMask(options.area))

  // Tyhjä ydin: osuudella ei ole mitään upotettavaa, joten koko väli on täyttöä.
  const inserted = insertIntoRun(
    track,
    library,
    inventoryFillTable(library, inventory),
    inventory,
    section,
    (cursor) => ({ placed: [], exit: cursor }),
    0,
  )
  if (!inserted) return failure('no-fill')

  const assembled = assembleTrack(
    track,
    { pieces: inserted.pieces, joints: inserted.joints, localJoints: inserted.localJoints, gapMm: inserted.gapMm },
    { library, inventory, vario: options.vario, flex: options.flex, bounds },
  )
  if (!assembled.track) return failure(assembled.reason)

  return {
    track: assembled.track,
    reason: 'ok',
    pieceCount: Object.values(inserted.added).reduce((sum, count) => sum + count, 0),
    added: inserted.added,
    removed: inserted.removed,
    withinInventory: Object.keys(assembled.track.shortages).length === 0,
  }
}

function failure(reason: FillGapReason): FillGapResult {
  return { track: null, reason, pieceCount: 0, added: {}, removed: {}, withinInventory: true }
}
