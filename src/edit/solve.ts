import { inventoryFillTable } from '../core/fill'
import { unlimitedInventory, type Inventory } from '../core/inventory'
import { defaultLibrary, type PieceLibrary } from '../core/library'
import type { FlexSettings, VarioSettings } from '../core/vario'
import type { Track } from '../gen/build'
import { areaBounds, buildMask, type AreaShape } from '../gen/mask'
import { assembleTrack } from './assemble'
import { insertIntoRun } from './branch'
import { newPieceIndices } from './extend'
import { availableInventory } from './replace'
import { sectionBrief, type Section } from './section'
import { swapOptions } from './swap'
import { bundledVariationSpecs, resolveVariation, type VariationSpec } from './variations'

// Autosolver (README luku 6): "Vaihtoehdot" antaa valitulle osuudelle 2–4
// valmista ehdotusta haamuesikatseluina. Ehdotuksia on kahta lajia, ja kumpikin
// vastaa samaan tehtävänantoon (päätyportit, pituus, sivutila, palat):
//
// - **Variaatiokuvio** (`variations.ts`) korvaa koko osuuden: sivuraide,
//   ohituskaide, S-kiemura, pullistuma, mäki, viisto venytys, risteys + haara.
// - **Palan vaihto** (`swap.ts`) vaihtaa yhden palan saman porttisignatuurin
//   toteutukseen. Se on yhden palan osion vastaus samaan kysymykseen.
//
// Pisteytys on README:n mukainen: monipuolisuus (uusi palatyyppi radalla on
// bonus), inventaario (puuttuva pala on kallis) ja joustobudjetti (kireä rata
// on kallis). Halvin ensin, ja samaa kuviotyyppiä tarjotaan vain kerran — kaksi
// lähes samanlaista haamua kartalla ei ole valinta vaan sotku.

export interface SolveOptions {
  area: AreaShape
  library?: PieceLibrary
  inventory?: Inventory
  vario?: VarioSettings
  flex?: FlexSettings
  /** Omat kuviot testeille; oletus on `data/variations/`. */
  variations?: readonly VariationSpec[]
  /** Montako vaihtoehtoa palautetaan haamuesikatseluiksi. */
  maxOptions?: number
}

export interface SolveOption {
  kind: 'variation' | 'swap'
  /** Kuvion tunnus (`siding-right`) tai tilalle tulevan palan tunnus (`T`). */
  id: string
  /** Kuviotyyppi (`siding`, `bulge`, …) tai `swap`. Sama tyyppi tarjotaan kerran. */
  family: string
  track: Track
  /** Uusien ja muuttuneiden palojen indeksit — haamuesikatselu piirtää nämä. */
  addedIndices: number[]
  /** Palamuutoskortti (README luku 6): "käyttää 1×L · vapauttaa 1×D". */
  added: Record<string, number>
  removed: Record<string, number>
  pieceCount: number
  withinInventory: boolean
  cost: number
}

/** Uusi palatyyppi radalle on README:n mukaan bonus: monipuolisuus palkitaan. */
const VARIETY_BONUS = 300

/** Puuttuva pala ei estä ehdotusta muttei myöskään voita vertailua. */
const SHORTAGE_COST = 400

/** Kireä rata on kallis: jokainen kuvio kuluttaa Variota, ja se pitää näkyä. */
const TIGHTNESS_COST = 4

/** Pitkä kuvio on työläämpi koota kuin lyhyt; ratkaisee vain tasapelit. */
const PIECE_COST = 3

/**
 * Osuuden vaihtoehdot parhaimmasta alkaen. Alkuperäinen rata jää
 * koskemattomaksi: jokainen vaihtoehto on oma valmis ratansa, ja käyttäjä
 * valitsee niistä yhden napauttamalla haamua kartalla.
 */
export function solveSection(track: Track, section: Section, options: SolveOptions): SolveOption[] {
  const library = options.library ?? defaultLibrary()
  const inventory = options.inventory ?? unlimitedInventory()
  const found: SolveOption[] = [
    ...variationOptions(track, section, options, library, inventory),
    ...swapOptions(track, section, { ...options, library, inventory }).map((option) => ({
      kind: 'swap' as const,
      id: option.toId,
      family: 'swap',
      track: option.track,
      addedIndices: option.addedIndices,
      added: option.added,
      removed: option.removed,
      pieceCount: 1,
      withinInventory: option.withinInventory,
      cost: option.cost + score(track, option.track, option.added, option.withinInventory, 1),
    })),
  ]

  const seen = new Set<string>()
  return found
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id))
    .filter((option) => {
      if (seen.has(option.family)) return false
      seen.add(option.family)
      return true
    })
    .slice(0, options.maxOptions ?? 3)
}

function variationOptions(
  track: Track,
  section: Section,
  options: SolveOptions,
  library: PieceLibrary,
  inventory: Inventory,
): SolveOption[] {
  if (!section.replaceable) return []

  const runMm = section.indices.reduce((sum, index) => sum + library.get(track.pieces[index].pieceId).lengthMm, 0)
  // Kuvio upotetaan suoralle osuudelle. Mutkan yli venytetty valinta ei ole
  // suora, ja sen tunnistaa siitä että sen nimellispituus on pidempi kuin
  // päätyporttien väli.
  if (Math.abs(runMm - Math.hypot(section.end.x - section.start.x, section.end.y - section.start.y)) > 1) return []

  const brief = sectionBrief(track, library, options.area, section)
  const available = availableInventory(track, section, inventory)
  const table = inventoryFillTable(library, available)
  const bounds = areaBounds(buildMask(options.area))
  const results: SolveOption[] = []

  for (const spec of options.variations ?? bundledVariationSpecs()) {
    const resolved = resolveVariation(spec, library, table, available, runMm)
    if (!resolved) continue
    // Sivutila on osa tehtävänantoa (README luku 6). Sekä osuuden vapaa käytävä
    // että kuvion ulottuma on mitattu keskilinjasta, joten ne ovat suoraan
    // vertailukelpoisia.
    if (resolved.leftMm > brief.leftMm || resolved.rightMm > brief.rightMm) continue

    const inserted = insertIntoRun(
      track,
      library,
      table,
      inventory,
      section,
      (cursor) => {
        const run = resolved.run(cursor)
        return run
          ? { placed: run.placed, exit: run.exit, edges: run.edges, exitIndex: run.exitIndex, gapMm: run.linkGapMm }
          : null
      },
      // Kuvio keskitetään osuudelle: täyttöä jää yhtä paljon kumpaankin päähän.
      (runMm - resolved.alongMm) / 2,
      { snapFill: true },
    )
    if (!inserted) continue

    const assembled = assembleTrack(
      track,
      { pieces: inserted.pieces, joints: inserted.joints, localJoints: inserted.localJoints, gapMm: inserted.gapMm },
      { library, inventory, vario: options.vario, flex: options.flex, bounds },
    )
    if (!assembled.track) continue

    const withinInventory = Object.keys(assembled.track.shortages).length === 0
    results.push({
      kind: 'variation',
      id: spec.id,
      family: spec.kind,
      track: assembled.track,
      addedIndices: newPieceIndices(track, assembled.track),
      added: inserted.added,
      removed: inserted.removed,
      pieceCount: resolved.pieceCount,
      withinInventory,
      cost: score(track, assembled.track, resolved.pieceCounts, withinInventory, resolved.pieceCount),
    })
  }

  return results
}

/**
 * Ehdotuksen hinta. Halvin voittaa, joten bonukset ovat negatiivisia.
 * Monipuolisuus mitataan siitä, onko radalla jo tämän kuvion palatyyppejä:
 * ensimmäinen sivuraide muuttaa radan luonnetta, kolmas ei enää.
 */
function score(
  before: Track,
  after: Track,
  uses: Record<string, number>,
  withinInventory: boolean,
  pieceCount: number,
): number {
  const fresh = Object.keys(uses).some((id) => (before.usage[id] ?? 0) === 0)
  const shortage = Object.values(after.shortages).reduce((sum, count) => sum + count, 0)
  return (
    (fresh ? -VARIETY_BONUS : 0) +
    (withinInventory ? 0 : SHORTAGE_COST) +
    shortage * SHORTAGE_COST +
    after.closure.tightnessPct * TIGHTNESS_COST +
    pieceCount * PIECE_COST
  )
}
