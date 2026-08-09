// Determinismi on kova reunaehto (CLAUDE.md): sama siemen + asetukset -> sama rata.
// Siksi kaikki satunnaisuus kulkee tämän moduulin läpi; Math.randomia ei käytetä
// generointipolulla lainkaan.

const UINT32 = 0x100000000

/** splitmix32 — pieni, nopea ja hyvin sekoittava. */
function splitmix32(state: number): { value: number; state: number } {
  let next = (state + 0x9e3779b9) >>> 0
  let z = next
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
  z = (z ^ (z >>> 15)) >>> 0
  return { value: z, state: next }
}

export interface Rng {
  /** Seuraava 32-bittinen kokonaisluku. */
  nextUint32(): number
  /** Tasajakauma [0, 1). */
  float(): number
  /** Kokonaisluku [0, maxExclusive). */
  int(maxExclusive: number): number
  /** Kokonaisluku [min, max]. */
  range(min: number, max: number): number
  bool(probability?: number): boolean
  pick<T>(items: readonly T[]): T
  /** Painotettu arvonta; painot ≥ 0, ainakin yksi > 0. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T
  /** Fisher–Yates, palauttaa uuden taulukon. */
  shuffle<T>(items: readonly T[]): T[]
  /** Haaroittaa uuden riippumattoman virran — sama haara samasta tilasta aina. */
  fork(label: number): Rng
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0
  const nextUint32 = (): number => {
    const step = splitmix32(state)
    state = step.state
    return step.value
  }

  const rng: Rng = {
    nextUint32,
    float: () => nextUint32() / UINT32,
    int(maxExclusive) {
      if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0
      return Math.floor(rng.float() * maxExclusive)
    },
    range: (min, max) => min + rng.int(max - min + 1),
    bool: (probability = 0.5) => rng.float() < probability,
    pick(items) {
      if (items.length === 0) throw new RangeError('pick() from an empty list')
      return items[rng.int(items.length)]
    },
    weighted(items, weights) {
      if (items.length === 0) throw new RangeError('weighted() from an empty list')
      const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0)
      if (total <= 0) return rng.pick(items)
      let threshold = rng.float() * total
      for (let i = 0; i < items.length; i += 1) {
        threshold -= Math.max(0, weights[i] ?? 0)
        if (threshold < 0) return items[i]
      }
      return items[items.length - 1]
    },
    shuffle(items) {
      const copy = [...items]
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = rng.int(i + 1)
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      return copy
    },
    fork: (label) => makeRng(deriveSeed(state, label)),
  }

  return rng
}

/**
 * Johtaa alisiemenen pääsiemenestä (R4). Käyttäjän siemen on pääsiemen, josta
 * N ehdokassiementä johdetaan deterministisesti — sama pääsiemen tuottaa aina
 * saman voittajan.
 */
export function deriveSeed(masterSeed: number, index: number): number {
  let state = (masterSeed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0
  for (let i = 0; i < 2; i += 1) {
    const step = splitmix32(state)
    state = step.value
  }
  return state >>> 0
}

/** Käyttäjän kirjoittama siemen (esim. "kaisan rata") 32-bittiseksi luvuksi. */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Siemen esitysmuotoon, joka menee URL:iin ja näytetään käyttäjälle. */
export function seedToString(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase().padStart(7, '0')
}

export function seedFromInput(input: string | number): number {
  if (typeof input === 'number') return input >>> 0
  const trimmed = input.trim()
  const asBase36 = /^[0-9A-Z]{1,7}$/i.test(trimmed) ? Number.parseInt(trimmed, 36) : Number.NaN
  if (Number.isFinite(asBase36) && trimmed.length === 7) return asBase36 >>> 0
  return seedFromString(trimmed)
}
