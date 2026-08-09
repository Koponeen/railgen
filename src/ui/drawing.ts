import { t } from '../i18n'
import type { FitReason, FitResult } from '../fit'
import type { ReplaceReason, Section, SectionBrief } from '../edit'
import type { Track } from '../gen/build'
import type { Point, SectionHandles } from './state'

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
  /** Viimeisimmän korvauksen mitat statusriville. */
  pieceCount: number
  deviationMm: number
  withinInventory: boolean
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

/** Osion päätykahvat kartalle. */
export function handlesOf(section: Section): SectionHandles {
  return {
    start: { x: section.start.x, y: section.start.y },
    end: { x: section.end.x, y: section.end.y },
  }
}
