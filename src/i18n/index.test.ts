import { describe, expect, it } from 'vitest'
import fi from '../../locales/fi.json'
import en from '../../locales/en.json'
import { availableLanguages, getLanguage, t, tOptional } from './index'
import { formatCm, formatMetres, formatNumber } from './format'
import { pieceName } from './pieces'
import { defaultLibrary } from '../core/library'

describe('i18n', () => {
  it('defaults to Finnish outside the browser', () => {
    expect(getLanguage()).toBe('fi')
  })

  it('lists all shipped locales', () => {
    expect(availableLanguages().sort()).toEqual(['en', 'fi'])
  })

  it('resolves a nested key', () => {
    expect(t('nav.area')).toBe('Alue')
  })

  it('interpolates {name} placeholders', () => {
    expect(t('generate.summary', { pieces: 42, length: '4,8', tightness: '9 %' })).toBe(
      '42 palaa · 4,8 m · kireys 9 %',
    )
  })

  it('falls back to the key itself when missing', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
    expect(tOptional('does.not.exist')).toBeNull()
  })
})

/** i18n-sääntö 5: fi.json on referenssi, muiden lokaalien on pysyttävä synkassa. */
function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('locale parity', () => {
  it('gives every Finnish key an English translation', () => {
    const missing = leafKeys(fi).filter((key) => !leafKeys(en).includes(key))
    expect(missing).toEqual([])
  })

  it('has no English keys the reference locale lacks', () => {
    const extra = leafKeys(en).filter((key) => !leafKeys(fi).includes(key))
    expect(extra).toEqual([])
  })

  it('leaves no user-visible string untranslated', () => {
    for (const key of leafKeys(fi)) {
      expect(tOptional(key), key).toBeTruthy()
    }
  })
})

describe('piece names', () => {
  it('names every bundled piece', () => {
    for (const piece of defaultLibrary().pieces) {
      expect(pieceName(piece.id), piece.id).not.toBe(piece.id)
    }
  })

  it('falls back to the id for a piece with no translation yet (R8)', () => {
    expect(pieceName('CUSTOM_3D_PART')).toBe('CUSTOM_3D_PART')
  })
})

describe('number formatting', () => {
  it('formats through Intl so the locale decides the separators', () => {
    expect(formatNumber(1234)).toBe(new Intl.NumberFormat('fi').format(1234))
    expect(formatCm(2000)).toBe('200')
    expect(formatMetres(4850)).toBe(new Intl.NumberFormat('fi', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(4.85))
  })
})
