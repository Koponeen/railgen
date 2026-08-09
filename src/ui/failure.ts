import { t } from '../i18n'

// Rehellinen virheilmoitus, ei suistavaa rataa (README luku 2). Generaattori
// palauttaa syyn per hylätty ehdokas; käyttäjälle näytetään yleisin niistä.

const KNOWN_REASONS = new Set([
  'area-too-small',
  'no-corner-elements-affordable',
  'inventory-or-placement-failed',
  'closure-beyond-budget',
  'joint-over-safety-cap',
  'self-collision',
  'outside-area',
])

export function describeFailure(rejections: readonly string[]): string {
  if (rejections.length === 0) return t('generate.failure.unknown')

  const counts = new Map<string, { count: number; detail: string }>()
  for (const rejection of rejections) {
    const [reason, detail = ''] = rejection.split(':')
    const entry = counts.get(reason) ?? { count: 0, detail }
    entry.count += 1
    if (detail) entry.detail = detail
    counts.set(reason, entry)
  }

  const [reason, entry] = [...counts.entries()].sort((a, b) => b[1].count - a[1].count)[0]
  if (!KNOWN_REASONS.has(reason)) return t('generate.failure.unknown')

  // "closure-beyond-budget:23mm" -> "jää 23 mm vajaaksi".
  return t(`generate.failure.${reason}`, { shortfall: entry.detail.replace('mm', '') })
}
