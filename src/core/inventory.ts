// Inventaario: mitä paloja käyttäjällä on. Skippaustilassa palat ovat rajattomat
// ja tulos on ostoslista (README luku 7, sivu 2).

export interface Inventory {
  /** Skippaustila: rajattomat peruspalat, tulos on ostoslista. */
  unlimited: boolean
  counts: Readonly<Record<string, number>>
}

export function createInventory(counts: Record<string, number> = {}, unlimited = false): Inventory {
  return { unlimited, counts: { ...counts } }
}

export function unlimitedInventory(): Inventory {
  return { unlimited: true, counts: {} }
}

/**
 * Mitä käyttö vaatisi lisää ("vaatisi 2×E lisää"). Kirjanpidon oma
 * `shortages()` riittää kun rata on rakennettu inventaariota vasten, mutta
 * piirretty rata sovitetaan tarvittaessa rajattomilla paloilla — silloin
 * puutteet on laskettava valmiista käytöstä.
 */
export function shortagesAgainst(usage: Readonly<Record<string, number>>, inventory: Inventory): Record<string, number> {
  if (inventory.unlimited) return {}
  const result: Record<string, number> = {}
  for (const [id, count] of Object.entries(usage)) {
    const missing = count - (inventory.counts[id] ?? 0)
    if (missing > 0) result[id] = missing
  }
  return result
}

/**
 * Käytön kirjanpito. Epäonnistunut mutaatio hylätään siististi, joten
 * kirjanpidosta pitää voida ottaa kopio ja palata siihen (CLAUDE.md).
 */
export class Ledger {
  private readonly inventory: Inventory
  private readonly usedCounts: Map<string, number>

  constructor(inventory: Inventory, used?: Map<string, number>) {
    this.inventory = inventory
    this.usedCounts = new Map(used ?? [])
  }

  get unlimited(): boolean {
    return this.inventory.unlimited
  }

  stock(pieceId: string): number {
    if (this.inventory.unlimited) return Infinity
    return this.inventory.counts[pieceId] ?? 0
  }

  used(pieceId: string): number {
    return this.usedCounts.get(pieceId) ?? 0
  }

  available(pieceId: string): number {
    return this.stock(pieceId) - this.used(pieceId)
  }

  take(pieceId: string, count = 1): boolean {
    if (this.available(pieceId) < count) return false
    this.usedCounts.set(pieceId, this.used(pieceId) + count)
    return true
  }

  release(pieceId: string, count = 1): void {
    this.usedCounts.set(pieceId, Math.max(0, this.used(pieceId) - count))
  }

  clone(): Ledger {
    return new Ledger(this.inventory, this.usedCounts)
  }

  /** Osaluettelo: mitä rata kuluttaa. */
  usage(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [id, count] of this.usedCounts) {
      if (count > 0) result[id] = count
    }
    return result
  }

  /** Ostoslista: mitä pitäisi hankkia lisää (skippaustilassa koko käyttö). */
  shortages(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [id, count] of this.usedCounts) {
      const missing = count - this.stock(id)
      if (missing > 0) result[id] = missing
    }
    return result
  }

  totalUsed(): number {
    let total = 0
    for (const count of this.usedCounts.values()) total += count
    return total
  }
}
