import { t } from '../i18n'
import type { FitReason, FitResult } from '../fit'
import type { Point } from './state'

// Piirretyn radan tila sivulla 3. Raakaviiva säilytetään sovituksen rinnalla:
// kartalla näkyy sekä se mitä käyttäjä piirsi että se mitä siitä tuli.

export interface DrawingState {
  points: Point[]
  result: FitResult
}

const KNOWN_REASONS = new Set<FitReason>([
  'drawing-too-short',
  'no-fit',
  'closure-beyond-budget',
  'joint-over-safety-cap',
  'self-collision',
])

/** Rehellinen syy sille, miksi vedosta ei tullut rataa (README luku 5). */
export function describeFitFailure(reason: FitReason): string {
  return KNOWN_REASONS.has(reason) ? t(`draw.failure.${reason}`) : t('draw.failure.unknown')
}
