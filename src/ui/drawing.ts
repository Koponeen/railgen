import { t } from '../i18n'
import { pieceName } from '../i18n/pieces'
import { variationName } from '../i18n/variations'
import type { FitReason, FitResult } from '../fit'
import type {
  BranchOption,
  ExtendReason,
  FillGapReason,
  GapMarker,
  ReplaceReason,
  Section,
  SectionBrief,
  SolveOption,
} from '../edit'
import type { Track } from '../gen/build'
import type { Ghost, Point, SectionHandles } from './state'

// Piirretyn ja muokatun radan tila sivulla 3. Raakaviiva säilytetään sovituksen
// rinnalla: kartalla näkyy sekä se mitä käyttäjä piirsi että se mitä siitä tuli.

export interface DrawingState {
  points: Point[]
  result: FitResult
}

/**
 * Miksi osiolle ei tullut uutta muotoa. Yritykset ovat eri koneistoja ja siksi
 * eri syitä: piirretty korvaus, automaattinen täyttö ja autosolverin tyhjä
 * vastaus sanovat kukin omin sanoin mitä tapahtui.
 */
export type SectionNote =
  | { kind: 'replace'; reason: ReplaceReason }
  | { kind: 'fill'; reason: FillGapReason }
  | { kind: 'no-options' }

/** Valittu osio: rajaus, tehtävänanto ja viimeisin epäonnistunut yritys. */
export interface SectionState {
  section: Section
  brief: SectionBrief
  handles: SectionHandles
  note: SectionNote | null
}

/**
 * Poistettu osio odottamassa ratkaisuaan (README luku 6): kartalla näkyy
 * aukkomerkki, ja käyttäjä joko täyttää sen, piirtää tilalle tai kumoaa. Rata
 * itse on yhä alkuperäinen — esikatselu ei ole se rata jota muokataan.
 */
export interface RemovalState {
  preview: Track
  gap: GapMarker
}

/** Mikä muokkaus radalle viimeksi tehtiin. */
export type EditKind = 'replace' | 'branch' | 'variation' | 'swap' | 'fill'

/** Käsin muokattu rata. Elää generoidun ja piirretyn rinnalla, joten paluu on aina auki. */
export interface EditState {
  track: Track
  kind: EditKind
  /** Mitä tehtiin, valmiiksi käännettynä: "Sivuraide", "Haara (L)". */
  label: string | null
  /** Viimeisimmän muokkauksen mitat statusriville. */
  pieceCount: number
  deviationMm: number
  withinInventory: boolean
  /** Palamuutoskortti (README luku 6), nettona. */
  change: { added: Record<string, number>; removed: Record<string, number> } | null
}

/**
 * Yksi ratkaisematta oleva vaihtoehto. Haara, variaatiokuvio ja palan vaihto
 * tulevat eri koneistoista, mutta kartalle ja toimintoriville ne menevät
 * samanlaisina — haamu, nimilappu ja palamuutoskortti.
 */
export interface ChoiceOption {
  kind: EditKind
  label: string
  track: Track
  /** Haamuesikatselun palat radan `pieces`-indekseinä. */
  addedIndices: number[]
  /** Mille paloille numerolappu asetetaan; haaralla se on haaran oma ketju. */
  tagIndices: number[]
  added: Record<string, number>
  removed: Record<string, number>
  pieceCount: number
  withinInventory: boolean
}

/**
 * Ratkaisematta oleva kysymys: 2–4 vaihtoehtoa, joista käyttäjä valitsee
 * napauttamalla haamua kartalla. Piirretty viiva säilyy, jotta kartalla näkyy
 * yhä se mitä käyttäjä pyysi.
 */
export interface EditChoice {
  options: ChoiceOption[]
  points: Point[] | null
}

/** Haaravaihtoehto kartalle vietäväksi. */
export function branchChoice(options: readonly BranchOption[], points: Point[]): EditChoice {
  return {
    points,
    options: options.map((option) => ({
      kind: 'branch' as const,
      label: describeBranchOption(option),
      track: option.track,
      addedIndices: option.addedIndices,
      // Vaihtoehdot lähtevät samasta kohdasta ja eroavat vasta myöhemmin, joten
      // numerolappu asetetaan haaran omalle ketjulle eikä koko muutokselle.
      tagIndices: tailIndices(option.track, option.pieceCount),
      added: option.added,
      removed: option.removed,
      pieceCount: option.pieceCount,
      withinInventory: option.withinInventory,
    })),
  }
}

/** Autosolverin ehdotus kartalle vietäväksi. */
export function solveChoice(options: readonly SolveOption[]): EditChoice {
  return {
    points: null,
    options: options.map((option) => ({
      kind: option.kind,
      label: option.kind === 'swap' ? t('swap.option', { piece: pieceName(option.id) }) : variationName(option.family),
      track: option.track,
      addedIndices: option.addedIndices,
      tagIndices: option.addedIndices,
      added: option.added,
      removed: option.removed,
      pieceCount: option.pieceCount,
      withinInventory: option.withinInventory,
    })),
  }
}

function tailIndices(track: Track, count: number): number[] {
  return Array.from({ length: Math.min(count, track.pieces.length) }, (_, i) => track.pieces.length - count + i)
}

/** Valittu vaihtoehto muokkaustilaksi. */
export function editStateOf(option: ChoiceOption): EditState {
  return {
    track: option.track,
    kind: option.kind,
    label: option.label,
    pieceCount: option.pieceCount,
    deviationMm: 0,
    withinInventory: option.withinInventory,
    change: netChange(option.added, option.removed),
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
export function ghostsOf(options: readonly ChoiceOption[]): Ghost[] {
  return options.map((option, index) => ({
    index,
    pieces: option.addedIndices.map((pieceIndex) => option.track.pieces[pieceIndex]),
    tag: tagPoint(
      option.tagIndices.map((pieceIndex) => option.track.pieces[pieceIndex]?.placement),
      index,
      options.length,
    ),
  }))
}

/**
 * Numerolapun paikka vaihtoehdon omalta ketjulta. Vaihtoehdot ovat samassa
 * kohdassa rataa, joten kukin lappu asetetaan eri kohtaan omaa muutostaan —
 * muuten ne kasautuisivat päällekkäin eikä alimpaan voisi osua sormella.
 */
function tagPoint(points: readonly (Point | undefined)[], index: number, count: number): Point {
  const usable = points.filter((point): point is Point => point !== undefined)
  if (usable.length === 0) return { x: 0, y: 0 }
  const share = (index + 1) / (count + 1)
  return usable[Math.round((usable.length - 1) * share)]
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

const KNOWN_GAP_REASONS = new Set<FillGapReason>([
  'section-not-removable',
  'no-fill',
  'ends-beyond-budget',
  'joint-over-safety-cap',
  'self-collision',
])

/** Rehellinen syy sille, miksi vedosta ei tullut rataa (README luku 5). */
export function describeFitFailure(reason: FitReason): string {
  return KNOWN_FIT_REASONS.has(reason) ? t(`draw.failure.${reason}`) : t('draw.failure.unknown')
}

/** Rehellinen syy sille, miksi osiolle ei tullut uutta muotoa (README luku 6). */
export function describeSectionNote(note: SectionNote): string {
  if (note.kind === 'no-options') return t('section.failure.no-options')
  if (note.kind === 'fill') {
    return KNOWN_GAP_REASONS.has(note.reason) ? t(`gap.failure.${note.reason}`) : t('gap.failure.unknown')
  }
  return KNOWN_REPLACE_REASONS.has(note.reason) ? t(`section.failure.${note.reason}`) : t('section.failure.unknown')
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

/**
 * Vaihtoehdon nimilappu. Risteämän ratkaisu kertoo itsestään eniten, joten se
 * voittaa nimessä; muuten kerrotaan millainen haara on kyseessä. Erot ovat
 * käyttäjälle olennaisia: yhdistävä haara on ohituskaide, tynkä pysähtyy ennen
 * rataa, ja tavallisella on vapaa pää.
 */
export function describeBranchOption(option: BranchOption): string {
  if (option.crossing !== 'none') {
    return t(`branch.option.${option.crossing}`, { piece: option.junctionId, crossing: option.crossingId ?? '' })
  }
  if (option.variant === 'rejoin') {
    return t('branch.option.rejoin', { piece: option.junctionId, rejoin: option.rejoinId ?? '' })
  }
  if (option.variant === 'stub') return t('branch.option.stub', { piece: option.junctionId })
  return t('branch.option.plain', { piece: option.junctionId })
}

/** Osion päätykahvat kartalle. */
export function handlesOf(section: Section): SectionHandles {
  return {
    start: { x: section.start.x, y: section.start.y },
    end: { x: section.end.x, y: section.end.y },
  }
}
