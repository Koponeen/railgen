import { createInventory, unlimitedInventory, type Inventory } from '../core/inventory'
import { DEFAULT_FLEX, type FlexSettings } from '../core/vario'
import type { AreaShape } from '../gen/mask'

// Sivujen 1 ja 2 asetukset. Tila localStorageen, ei käyttäjätilejä (README luku 9).

export interface FlexPieceSettings {
  enabled: boolean
  count: number
}

export interface AppSettings {
  area: AreaShape
  /** Palojen lukumäärät tyypeittäin. */
  inventoryCounts: Record<string, number>
  /** Skippaus: rajattomat peruspalat, tulos on ostoslista (README luku 7). */
  skipInventory: boolean
  flex: FlexPieceSettings
  /** Käyttäjän siemen tekstinä; tyhjä = arvotaan. */
  seed: string
}

const STORAGE_KEY = 'railgen.settings.v1'

export const AREA_MIN_MM = 800
export const AREA_MAX_MM = 6000
/** Alue säädetään 10 cm:n askelin — sormella ei osu millilleen. */
export const AREA_STEP_MM = 100

export const DEFAULT_SETTINGS: AppSettings = {
  area: { kind: 'rect', widthMm: 2000, depthMm: 1500 },
  inventoryCounts: { A2: 4, A1: 4, A: 4, D: 4, E: 8, E1: 4 },
  skipInventory: true,
  flex: { enabled: false, count: 1 },
  seed: '',
}

/** Pikakoot sivulla 1 (README luku 7): nimet ovat käännösavaimia. */
export const QUICK_SIZES: { key: string; area: AreaShape }[] = [
  { key: 'small', area: { kind: 'rect', widthMm: 1600, depthMm: 1200 } },
  { key: 'rug', area: { kind: 'rect', widthMm: 2000, depthMm: 1500 } },
  { key: 'large', area: { kind: 'rect', widthMm: 2400, depthMm: 1700 } },
  { key: 'floor', area: { kind: 'rect', widthMm: 3000, depthMm: 2200 } },
]

/**
 * Yleiset kokoluokat inventaariolle. Nämä eivät väitä olevansa minkään tietyn
 * BRIO-setin sisältö — todelliset settikohtaiset esiasetukset tulevat
 * admin-palakirjaston kautta, kun setit on tarkistettu.
 */
export const INVENTORY_PRESETS: { key: string; counts: Record<string, number> }[] = [
  { key: 'starter', counts: { A2: 2, A1: 2, A: 2, D: 2, E: 8 } },
  { key: 'medium', counts: { A2: 4, A1: 4, A: 4, D: 4, E: 12, E1: 4, L: 1, M: 1 } },
  // Rampit ja kansi eivät yksin riitä mäkeen: laskeva ramppi kuljetaan
  // yläpäästä sisään, joten mäki tarvitsee myös sukupuolenvaihtajat C2 ja B2
  // (`data/elements/basic.json`). Ilman niitä tämä kokoelma sisältäisi mäen
  // palat muttei osaisi rakentaa mäkeä.
  { key: 'big', counts: { A2: 8, A1: 6, A: 6, D: 8, E: 20, E1: 8, L: 2, M: 2, N: 2, DECK216: 1, C2: 2, B2: 2 } },
]

export function loadSettings(): AppSettings | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeSettings(JSON.parse(raw) as Partial<AppSettings>)
  } catch {
    return null
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Yksityinen selaustila tms. — asetukset elävät silloin vain istunnon ajan.
  }
}

export function clearSettings(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ei mitään
  }
}

/** Täydentää puuttuvat kentät ja rajaa arvot sallituille väleille. */
export function normalizeSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const area = normalizeArea(input?.area)
  const counts: Record<string, number> = {}
  for (const [id, count] of Object.entries(input?.inventoryCounts ?? DEFAULT_SETTINGS.inventoryCounts)) {
    const value = Math.max(0, Math.min(99, Math.round(Number(count) || 0)))
    if (value > 0) counts[id] = value
  }
  return {
    area,
    inventoryCounts: counts,
    skipInventory: input?.skipInventory ?? DEFAULT_SETTINGS.skipInventory,
    flex: {
      enabled: input?.flex?.enabled ?? false,
      count: Math.max(1, Math.min(9, Math.round(Number(input?.flex?.count) || 1))),
    },
    seed: typeof input?.seed === 'string' ? input.seed : '',
  }
}

/** Pyöristys askeleeseen. Rajaus tehdään erikseen, koska nurkan minimi on eri. */
function snapToStep(value: unknown, fallback: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.round(number / AREA_STEP_MM) * AREA_STEP_MM
}

/** Alueen ulkomitat: askeleeseen ja sallitulle välille. */
function clampArea(value: unknown, fallback: number): number {
  return Math.max(AREA_MIN_MM, Math.min(AREA_MAX_MM, snapToStep(value, fallback)))
}

export function normalizeArea(area: AreaShape | undefined): AreaShape {
  if (!area || area.kind !== 'L') {
    const rect = area as { widthMm?: number; depthMm?: number } | undefined
    return {
      kind: 'rect',
      widthMm: clampArea(rect?.widthMm, DEFAULT_SETTINGS.area.widthMm),
      depthMm: clampArea(rect?.depthMm, DEFAULT_SETTINGS.area.depthMm),
    }
  }
  const widthMm = clampArea(area.widthMm, 2400)
  const depthMm = clampArea(area.depthMm, 1800)
  // Leikattu nurkka saa olla alueen minimiä pienempi; sitä rajaa vain se, ettei
  // se saa syödä koko aluetta.
  return {
    kind: 'L',
    widthMm,
    depthMm,
    cutWidthMm: Math.max(AREA_STEP_MM, Math.min(widthMm - AREA_STEP_MM * 2, snapToStep(area.cutWidthMm, 800))),
    cutDepthMm: Math.max(AREA_STEP_MM, Math.min(depthMm - AREA_STEP_MM * 2, snapToStep(area.cutDepthMm, 700))),
    corner: (['nw', 'ne', 'sw', 'se'] as const).includes(area.corner) ? area.corner : 'ne',
  }
}

export function toInventory(settings: AppSettings): Inventory {
  return settings.skipInventory ? unlimitedInventory() : createInventory(settings.inventoryCounts)
}

/**
 * Skippaustilassa joustopala on oletuksena pois, koska ostoslistalla saa olla
 * vain kaupasta saatavia paloja (README luku 2).
 */
export function toFlexSettings(settings: AppSettings): FlexSettings {
  const enabled = settings.flex.enabled && !settings.skipInventory
  return { ...DEFAULT_FLEX, count: enabled ? settings.flex.count : 0 }
}

export function areaNumbers(area: AreaShape): number[] {
  return area.kind === 'rect'
    ? [area.widthMm, area.depthMm]
    : [area.widthMm, area.depthMm, area.cutWidthMm, area.cutDepthMm]
}
