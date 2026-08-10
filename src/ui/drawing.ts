import { t } from '../i18n'
import type { FitReason, FitResult } from '../fit'
import type { BranchOption, ExtendReason, ReplaceReason, Section, SectionBrief } from '../edit'
import type { Track } from '../gen/build'
import type { Ghost, Point, SectionHandles } from './state'

// Piirretyn ja muokatun radan tila sivulla 3. Raakaviiva säilytetään sovituksen
// rinnalla: kartalla näkyy sekä se mitä käyttäjä piirsi että se mitä siitä tuli.

export interface DrawingState {
  points: Point[]
  result: FitResult
}

/** Valittu osio: rajaus, tehtävänanto ja viimeisin epäonnistunut korvausyritys. */
export interface SectionState {
  section: Section
  brief: SectionBrief
  handles: SectionHandles
  failure: ReplaceReason | null
}

/** Käsin muokattu rata. Elää generoidun ja piirretyn rinnalla, joten paluu on aina auki. */
export interface EditState {
  track: Track
  /** Kumpi muokkaus tämä oli: osion korvaus vai uusi haara. */
  kind: 'replace' | 'branch'
  /** Viimeisimmän muokkauksen mitat statusriville. */
  pieceCount: number
  deviationMm: number
  withinInventory: boolean
  /** Haaran palamuutoskortti (README luku 6), jos muokkaus oli haara. */
  branch: BranchSummary | null
}

export interface BranchSummary {
  junctionId: string
  crossing: BranchOption['crossing']
  crossingId: string | null
  added: Record<string, number>
  removed: Record<string, number>
}

/**
 * Ratkaisematta oleva kysymys: 2–3 vaihtoehtoa, joista käyttäjä valitsee
 * napauttamalla haamua kartalla. Piirretty viiva säilyy, jotta kartalla näkyy
 * yhä se mitä käyttäjä pyysi.
 */
export interface BranchChoice {
  options: BranchOption[]
  points: Point[]
}

export function branchSummaryOf(option: BranchOption): BranchSummary {
  return {
    junctionId: option.junctionId,
    crossing: option.crossing,
    crossingId: option.crossingId,
    ...netChange(option.added, option.removed),
  }
}

/**
 * Palamuutoskortti kertoo erotuksen, ei kirjanpitoa. Osuuden uudelleentäyttö
 * purkaa ja palauttaa samoja suoria, ja "käyttää 1×A1 · vapauttaa 1×A1" ei
 * kerro käyttäjälle mitään — vain netto kertoo mitä hyllystä oikeasti lähtee.
 */
export function netChange(
  added: Record<string, number>,
  removed: Record<string, number>,
): { added: Record<string, number>; removed: Record<string, number> } {
  const net: { added: Record<string, number>; removed: Record<string, number> } = { added: {}, removed: {} }
  for (const id of new Set([...Object.keys(added), ...Object.keys(removed)])) {
    const delta = (added[id] ?? 0) - (removed[id] ?? 0)
    if (delta > 0) net.added[id] = delta
    else if (delta < 0) net.removed[id] = -delta
  }
  return net
}

/** Haamut kartalle: vain ne palat, jotka vaihtoehto lisäisi tai siirtäisi. */
export function ghostsOf(options: readonly BranchOption[]): Ghost[] {
  return options.map((option, index) => ({
    index,
    pieces: option.addedIndices.map((pieceIndex) => option.track.pieces[pieceIndex]),
    tag: tagPoint(option.track.pieces.slice(option.track.pieces.length - option.pieceCount), index, options.length),
  }))
}

/**
 * Numerolapun paikka haaran omalta ketjulta. Vaihtoehdot lähtevät samasta
 * kohdasta ja eroavat vasta myöhemmin, joten kukin lappu asetetaan eri kohtaan
 * omaa haaraansa — muuten ne kasautuisivat päällekkäin eikä alimpaan voisi
 * osua sormella lainkaan.
 */
function tagPoint(branch: readonly { placement: Point }[], index: number, count: number): Point {
  if (branch.length === 0) return { x: 0, y: 0 }
  const share = (index + 1) / (count + 1)
  return branch[Math.round((branch.length - 1) * share)].placement
}

const KNOWN_FIT_REASONS = new Set<FitReason>([
  'drawing-too-short',
  'no-fit',
  'closure-beyond-budget',
  'joint-over-safety-cap',
  'self-collision',
])

const KNOWN_REPLACE_REASONS = new Set<ReplaceReason>([
  'section-not-replaceable',
  'drawing-too-short',
  'no-fit',
  'ends-beyond-budget',
  'joint-over-safety-cap',
  'self-collision',
])

/** Rehellinen syy sille, miksi vedosta ei tullut rataa (README luku 5). */
export function describeFitFailure(reason: FitReason): string {
  return KNOWN_FIT_REASONS.has(reason) ? t(`draw.failure.${reason}`) : t('draw.failure.unknown')
}

/** Rehellinen syy sille, miksi osiota ei voitu korvata (README luku 6). */
export function describeReplaceFailure(reason: ReplaceReason): string {
  return KNOWN_REPLACE_REASONS.has(reason) ? t(`section.failure.${reason}`) : t('section.failure.unknown')
}

const KNOWN_EXTEND_REASONS = new Set<ExtendReason>([
  'drawing-too-short',
  'not-on-track',
  'no-branch-point',
  'no-fit',
  'ends-beyond-budget',
  'joint-over-safety-cap',
  'self-collision',
  'crossing-unresolved',
])

/** Rehellinen syy sille, miksi haaraa ei saatu rataan (README luku 5). */
export function describeExtendFailure(reason: ExtendReason): string {
  return KNOWN_EXTEND_REASONS.has(reason) ? t(`branch.failure.${reason}`) : t('branch.failure.unknown')
}

/** Vaihtoehdon nimilappu: haarapala ja risteämän ratkaisu lyhyesti. */
export function describeBranchOption(option: BranchOption): string {
  if (option.crossing === 'none') return t('branch.option.plain', { piece: option.junctionId })
  return t(`branch.option.${option.crossing}`, { piece: option.junctionId, crossing: option.crossingId ?? '' })
}

/** Osion päätykahvat kartalle. */
export function handlesOf(section: Section): SectionHandles {
  return {
    start: { x: section.start.x, y: section.start.y },
    end: { x: section.end.x, y: section.end.y },
  }
}
