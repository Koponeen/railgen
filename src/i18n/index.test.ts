import { describe, expect, it } from 'vitest'
import { availableLanguages, getLanguage, t } from './index'

describe('i18n', () => {
  it('defaults to Finnish outside the browser', () => {
    expect(getLanguage()).toBe('fi')
  })

  it('lists all shipped locales', () => {
    expect(availableLanguages().sort()).toEqual(['en', 'fi'])
  })

  it('resolves a nested key', () => {
    expect(t('toolbar.draw')).toBe('Piirrä')
  })

  it('interpolates {name} placeholders', () => {
    expect(t('hud.summary', { mode: 'katselu', zoom: '1.00', count: 3 })).toBe(
      'tila: katselu · zoom: 1.00 · viivoja: 3',
    )
  })

  it('falls back to the key itself when missing', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })
})
