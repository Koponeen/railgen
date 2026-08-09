import type { AreaShape } from '../gen/mask'
import { normalizeSettings, type AppSettings } from './settings'

// Jako URL:n kautta (README luku 9). Vaiheessa 1c jaetaan siemen + asetukset,
// mikä mahtuu aina reilusti rajan alle. R6: jos serialisointi ylittää ~2000
// merkkiä, näytetään rehellinen ilmoitus eikä katkaistua linkkiä.

export const SHARE_PARAM = 'r'
export const MAX_URL_LENGTH = 2000

const VERSION = '1'
const FIELD = '~'

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const

function encodeArea(area: AreaShape): string {
  if (area.kind === 'rect') return `R,${area.widthMm},${area.depthMm}`
  return `L,${area.widthMm},${area.depthMm},${area.cutWidthMm},${area.cutDepthMm},${CORNERS.indexOf(area.corner)}`
}

function decodeArea(text: string): AreaShape | null {
  const parts = text.split(',')
  const numbers = parts.slice(1).map(Number)
  if (parts[0] === 'R' && numbers.length >= 2 && numbers.every(Number.isFinite)) {
    return { kind: 'rect', widthMm: numbers[0], depthMm: numbers[1] }
  }
  if (parts[0] === 'L' && numbers.length >= 5 && numbers.every(Number.isFinite)) {
    return {
      kind: 'L',
      widthMm: numbers[0],
      depthMm: numbers[1],
      cutWidthMm: numbers[2],
      cutDepthMm: numbers[3],
      corner: CORNERS[numbers[4]] ?? 'ne',
    }
  }
  return null
}

/** Tiivis kenttäpakattu esitys; base64url tulee päälle erikseen. */
export function serializeSettings(settings: AppSettings): string {
  const inventory = settings.skipInventory
    ? '*'
    : Object.entries(settings.inventoryCounts)
        .filter(([, count]) => count > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, count]) => `${id}:${count}`)
        .join(',')
  const flex = settings.flex.enabled ? `1:${settings.flex.count}` : '0'
  return [VERSION, encodeArea(settings.area), inventory, flex, settings.seed].join(FIELD)
}

export function deserializeSettings(text: string): AppSettings | null {
  const [version, areaText, inventoryText, flexText, ...seedParts] = text.split(FIELD)
  if (version !== VERSION) return null
  const area = decodeArea(areaText ?? '')
  if (!area) return null

  const skipInventory = inventoryText === '*'
  const inventoryCounts: Record<string, number> = {}
  if (!skipInventory) {
    for (const entry of (inventoryText ?? '').split(',')) {
      if (!entry) continue
      const [id, count] = entry.split(':')
      const value = Number(count)
      if (id && Number.isFinite(value) && value > 0) inventoryCounts[id] = value
    }
  }

  const [flexEnabled, flexCount] = (flexText ?? '0').split(':')
  return normalizeSettings({
    area,
    inventoryCounts,
    skipInventory,
    flex: { enabled: flexEnabled === '1', count: Number(flexCount) || 1 },
    // Siemen saattaa itse sisältää kenttäerottimen, joten loput liitetään takaisin.
    seed: seedParts.join(FIELD),
  })
}

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): string | null {
  try {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export interface ShareLink {
  url: string
  /** R6: liian pitkä linkki on rehellinen virhe, ei katkaistu URL. */
  tooLong: boolean
}

export function buildShareUrl(settings: AppSettings, base: string): ShareLink {
  const url = new URL(base)
  url.hash = ''
  url.searchParams.set(SHARE_PARAM, toBase64Url(serializeSettings(settings)))
  const text = url.toString()
  return { url: text, tooLong: text.length > MAX_URL_LENGTH }
}

/** Lukee jaetut asetukset osoiteriviltä, jos siellä on jakoparametri. */
export function readSharedSettings(search: string): AppSettings | null {
  const param = new URLSearchParams(search).get(SHARE_PARAM)
  if (!param) return null
  const text = fromBase64Url(param)
  return text === null ? null : deserializeSettings(text)
}
