// Suunnat 45 asteen lokeroissa (README luku 3: portin "suunta 45°-lokeroissa").
// 0 = +x. Kulma kasvaa kohti +y, joka SVG:n koordinaatistossa (y alas) näkyy
// myötäpäivään kiertona. Lokerointi on koko järjestelmän kova rajoite: portin
// suunta on aina kokonaisluku 0..7, muuten pala ei ole BRIO-yhteensopiva.

export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export const DIR_COUNT = 8
export const DEG_PER_DIR = 360 / DIR_COUNT

/** Kosini/sini lokeroittain taulukkona: akselisuunnat pysyvät eksakteina 0/±1. */
const HALF_SQRT2 = Math.SQRT1_2
const COS: readonly number[] = [1, HALF_SQRT2, 0, -HALF_SQRT2, -1, -HALF_SQRT2, 0, HALF_SQRT2]
const SIN: readonly number[] = [0, HALF_SQRT2, 1, HALF_SQRT2, 0, -HALF_SQRT2, -1, -HALF_SQRT2]

export function isDir(value: number): value is Dir {
  return Number.isInteger(value) && value >= 0 && value < DIR_COUNT
}

export function normalizeDir(value: number): Dir {
  return (((Math.round(value) % DIR_COUNT) + DIR_COUNT) % DIR_COUNT) as Dir
}

/** Vastakkainen suunta. Kaksi porttia voi liittyä vain vastakkaisiin suuntiin. */
export function oppositeDir(dir: Dir): Dir {
  return normalizeDir(dir + DIR_COUNT / 2)
}

/** Peilaus x-akselin suhteen (y -> -y) kääntää suunnan. */
export function mirrorDir(dir: Dir): Dir {
  return normalizeDir(-dir)
}

export function dirCos(dir: Dir): number {
  return COS[dir]
}

export function dirSin(dir: Dir): number {
  return SIN[dir]
}

export function dirToDegrees(dir: Dir): number {
  return dir * DEG_PER_DIR
}

export function dirToRadians(dir: Dir): number {
  return (dirToDegrees(dir) * Math.PI) / 180
}

/** Onko suunta akselin suuntainen (0/90/180/270)? Suorat pysyvät gridissä vain näillä. */
export function isAxisAligned(dir: Dir): boolean {
  return dir % 2 === 0
}

/**
 * Lähin 45°-lokero annetulle asteluvulle sekä jäännös, jonka Vario joutuu nielemään.
 * Palakirjaston validointi käyttää tätä: jäännös ≠ 0 vaatii "vaatii varioa" -lipun.
 */
export function snapDegreesToDir(degrees: number): { dir: Dir; residualDeg: number } {
  const slots = degrees / DEG_PER_DIR
  const nearest = Math.round(slots)
  return { dir: normalizeDir(nearest), residualDeg: degrees - nearest * DEG_PER_DIR }
}

/** Kulmaero asteina välillä (-180, 180]. */
export function angleDifferenceDeg(a: number, b: number): number {
  let diff = (a - b) % 360
  if (diff > 180) diff -= 360
  if (diff <= -180) diff += 360
  return diff
}
