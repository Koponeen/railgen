import { dirCos, dirSin, mirrorDir, normalizeDir, type Dir } from './dir'

export interface Vec {
  x: number
  y: number
}

/**
 * Palan sijoitus maailmaan. Peilaus tehdään ensin (x-akselin suhteen),
 * sitten rotaatio 45°-lokeroissa, lopuksi siirto. `level` on tasoluku
 * (0 = lattia, 1 = yksi 64 mm:n tasoero ylempänä).
 */
export interface Placement {
  x: number
  y: number
  rot: Dir
  mirror: boolean
  level: number
}

/** Kohdistin: mistä pisteestä ja mihin suuntaan rata jatkuu, millä tasolla. */
export interface Frame {
  x: number
  y: number
  dir: Dir
  level: number
}

export function vec(x: number, y: number): Vec {
  return { x, y }
}

export function addVec(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function subVec(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scaleVec(v: Vec, k: number): Vec {
  return { x: v.x * k, y: v.y * k }
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Yksikkövektori suuntaan. */
export function dirVector(dir: Dir): Vec {
  return { x: dirCos(dir), y: dirSin(dir) }
}

export function rotateVec(v: Vec, rot: Dir): Vec {
  const c = dirCos(rot)
  const s = dirSin(rot)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

export function mirrorVec(v: Vec): Vec {
  return { x: v.x, y: -v.y }
}

/** Piste palan omasta koordinaatistosta maailmaan. */
export function transformPoint(v: Vec, placement: Placement): Vec {
  const local = placement.mirror ? mirrorVec(v) : v
  const rotated = rotateVec(local, placement.rot)
  return { x: rotated.x + placement.x, y: rotated.y + placement.y }
}

/** Suunta palan omasta koordinaatistosta maailmaan. */
export function transformDir(dir: Dir, placement: Placement): Dir {
  const local = placement.mirror ? mirrorDir(dir) : dir
  return normalizeDir(local + placement.rot)
}

/** Kulma asteina palan koordinaatistosta maailmaan (kaarien kaarikulmille). */
export function transformDegrees(degrees: number, placement: Placement): number {
  const local = placement.mirror ? -degrees : degrees
  return local + placement.rot * 45
}

export function identityPlacement(): Placement {
  return { x: 0, y: 0, rot: 0, mirror: false, level: 0 }
}

export function frameEquals(a: Frame, b: Frame, epsMm: number): boolean {
  return Math.abs(a.x - b.x) <= epsMm && Math.abs(a.y - b.y) <= epsMm && a.dir === b.dir && a.level === b.level
}
