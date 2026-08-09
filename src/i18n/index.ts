import fi from '../../locales/fi.json'
import en from '../../locales/en.json'

// Kevyt oma i18n-moduuli (docs/IMPLEMENTATION_PLAN.md luku 2, R1 & i18n-säännöt).
// Ei i18next-riippuvuutta. fi.json on referenssi; puuttuva avain muissa
// lokaaleissa palautuu siihen, ja viime kädessä itse avaimeen.

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[]
type Locale = Record<string, JsonValue>
type Params = Record<string, string | number>

const FALLBACK_LANG = 'fi'
const locales: Record<string, Locale> = { fi, en }

function resolveLanguage(): string {
  if (typeof window === 'undefined') return FALLBACK_LANG
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (fromUrl && locales[fromUrl]) return fromUrl
  const stored = window.localStorage.getItem('lang')
  if (stored && locales[stored]) return stored
  const nav = window.navigator.language?.slice(0, 2)
  if (nav && locales[nav]) return nav
  return FALLBACK_LANG
}

let current = resolveLanguage()

export function getLanguage(): string {
  return current
}

export function setLanguage(lang: string): void {
  if (!locales[lang]) return
  current = lang
  if (typeof window !== 'undefined') window.localStorage.setItem('lang', lang)
}

export function availableLanguages(): string[] {
  return Object.keys(locales)
}

function lookup(locale: Locale, key: string): string | undefined {
  let node: JsonValue = locale
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined
    node = node[segment] ?? (undefined as unknown as JsonValue)
    if (node === undefined) return undefined
  }
  return typeof node === 'string' ? node : undefined
}

/** Kääntää avaimen nykyiselle kielelle ja korvaa `{nimi}`-paikkamerkit params-arvoilla. */
export function t(key: string, params?: Params): string {
  const template = lookup(locales[current], key) ?? lookup(locales[FALLBACK_LANG], key) ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}
