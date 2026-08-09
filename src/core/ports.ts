import { mirrorDir, normalizeDir, oppositeDir, type Dir } from './dir'
import { EPS_MM } from './units'
import { mirrorVec, rotateVec, transformDir, transformPoint, type Placement } from './vec'

/** Liittimet ovat sukupuolitettuja (README luku 2): tappi menee koloon. */
export type Connector = 'pin' | 'socket'

export interface Port {
  /** Palan sisällä yksilöivä tunnus, esim. "in" / "out" / "branch". */
  id: string
  x: number
  y: number
  /** Ulospäin osoittava suunta 45°-lokerossa. */
  dir: Dir
  connector: Connector
  /** Tasosiirtymä palan origoon nähden (N-rampin yläpää = 1). */
  levelOffset: number
  /**
   * Haaraportti ei kuulu korvausluokan signatuuriin. Näin T-risteys päätyy
   * automaattisesti läpimenevän suoransa korvausluokkaan (README luku 2).
   */
  branch: boolean
}

export function complementOf(connector: Connector): Connector {
  return connector === 'pin' ? 'socket' : 'pin'
}

export function transformPort(port: Port, placement: Placement): Port {
  const p = transformPoint({ x: port.x, y: port.y }, placement)
  return {
    id: port.id,
    x: p.x,
    y: p.y,
    dir: transformDir(port.dir, placement),
    connector: port.connector,
    levelOffset: port.levelOffset + placement.level,
    branch: port.branch,
  }
}

export interface MateOptions {
  /** Asetus "salli kääntö/adapterit" löysää liittimen sukupuolivaatimusta (README luku 2). */
  allowConnectorFlip?: boolean
  epsMm?: number
}

/** Voivatko kaksi maailmakoordinaatistossa olevaa porttia liittyä toisiinsa? */
export function canMate(a: Port, b: Port, options: MateOptions = {}): boolean {
  const eps = options.epsMm ?? EPS_MM
  if (Math.abs(a.x - b.x) > eps || Math.abs(a.y - b.y) > eps) return false
  if (a.dir !== oppositeDir(b.dir)) return false
  if (a.levelOffset !== b.levelOffset) return false
  if (!options.allowConnectorFlip && a.connector === b.connector) return false
  return true
}

// --- Porttisignatuurit ------------------------------------------------------
//
// Kaksi elementtiä (tai palaa) ovat vaihtokelpoisia, jos porttisignatuuri on
// sama (README luku 3). Signatuurin pitää siis olla riippumaton siitä, missä
// asennossa pala on kirjastoon kirjoitettu: kanonisoidaan siirtämällä jokainen
// portti vuorollaan origoon suuntaan 4 (länteen) ja valitsemalla pienin
// merkkijonoesitys.

function roundForKey(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2)
}

function serializePorts(ports: Port[]): string {
  return ports
    .map((p) => `${roundForKey(p.x)},${roundForKey(p.y)},${p.dir},${p.connector}`)
    .sort()
    .join(';')
}

/** Siirtää portit niin, että `reference` on origossa suuntaan 4. */
function alignTo(ports: Port[], reference: Port, mirror: boolean): Port[] {
  const flipped = mirror
    ? ports.map((p) => ({ ...p, ...mirrorVec({ x: p.x, y: p.y }), dir: mirrorDir(p.dir) }))
    : ports
  const ref = flipped[ports.indexOf(reference)]
  const rot = normalizeDir(4 - ref.dir)
  const refPos = rotateVec({ x: ref.x, y: ref.y }, rot)
  return flipped.map((p) => {
    const rotated = rotateVec({ x: p.x, y: p.y }, rot)
    return { ...p, x: rotated.x - refPos.x, y: rotated.y - refPos.y, dir: normalizeDir(p.dir + rot) }
  })
}

/**
 * Kanoninen avain porttijoukolle. `mirror` kertoo, saako palan kääntää nurin;
 * peilattava pala saa lisäksi peilatun avaimen (kaari kelpaa sekä vasemmalle
 * että oikealle mutkalle).
 */
export function portSignatures(ports: Port[], mirrorable: boolean): string[] {
  if (ports.length === 0) return ['']
  const keys = new Set<string>()
  for (const mirror of mirrorable ? [false, true] : [false]) {
    let best: string | null = null
    for (const reference of ports) {
      const key = serializePorts(alignTo(ports, reference, mirror))
      if (best === null || key < best) best = key
    }
    keys.add(best as string)
  }
  return [...keys].sort()
}

/** Onko kahdella palalla/elementillä yhteinen signatuuri eli ovatko ne vaihtokelpoisia? */
export function signaturesMatch(a: readonly string[], b: readonly string[]): boolean {
  return a.some((key) => b.includes(key))
}
