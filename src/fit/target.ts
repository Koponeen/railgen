import type { Vec } from '../core/vec'
import type { CleanDrawing } from './simplify'

// Sovituksen kohdeviiva. Keilahaku kysyy tältä kaksi asiaa: kuinka kaukana
// ehdokaspala on piirretystä viivasta ja kuinka pitkälle sitä pitkin päästiin.
//
// Molemmat kysytään aina ikkunassa nykyisen etenemän ympärillä, ei koko
// viivalta: itseään leikkaavassa piirroksessa lähin piste voi olla aivan
// toisessa kohdassa rataa, ja ilman ikkunaa sovitus hyppäisi sinne.

export interface Projection {
  /** Etäisyys kohdeviivasta millimetreinä. */
  distanceMm: number
  /** Etenemä kohdeviivaa pitkin millimetreinä. */
  alongMm: number
}

export interface TargetPath {
  points: readonly Vec[]
  /** Kumulatiivinen matka pisteeseen i asti. */
  cumMm: readonly number[]
  lengthMm: number
  closed: boolean
  project(point: Vec, fromMm: number, windowMm: number): Projection
  pointAt(alongMm: number): Vec
  /** Kulkusuunta asteina kohdassa `alongMm`, mitattuna `spanMm`:n matkalta. */
  headingDegAt(alongMm: number, spanMm: number): number
}

const DEG = 180 / Math.PI

export function buildTarget(drawing: CleanDrawing): TargetPath {
  const points = drawing.points
  const cumMm: number[] = [0]
  for (let i = 1; i < points.length; i += 1) {
    cumMm.push(cumMm[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  }
  const lengthMm = cumMm[cumMm.length - 1]

  function pointAt(alongMm: number): Vec {
    const clamped = Math.max(0, Math.min(lengthMm, alongMm))
    let index = 1
    while (index < cumMm.length - 1 && cumMm[index] < clamped) index += 1
    const spanMm = cumMm[index] - cumMm[index - 1]
    const t = spanMm > 0 ? (clamped - cumMm[index - 1]) / spanMm : 0
    const from = points[index - 1]
    const to = points[index]
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
  }

  return {
    points,
    cumMm,
    lengthMm,
    closed: drawing.closed,
    pointAt,

    headingDegAt(alongMm, spanMm) {
      const from = pointAt(alongMm)
      // Viivan lopussa mitataan taaksepäin, jotta suunta ei rappeudu nollaksi.
      const forward = alongMm + spanMm <= lengthMm
      const to = pointAt(forward ? alongMm + spanMm : alongMm - spanMm)
      const dx = forward ? to.x - from.x : from.x - to.x
      const dy = forward ? to.y - from.y : from.y - to.y
      return Math.atan2(dy, dx) * DEG
    },

    project(point, fromMm, windowMm) {
      const startMm = Math.max(0, fromMm)
      const endMm = Math.min(lengthMm, fromMm + windowMm)
      let bestDistance = Infinity
      let bestAlong = startMm

      for (let i = 1; i < points.length; i += 1) {
        if (cumMm[i] < startMm || cumMm[i - 1] > endMm) continue
        const from = points[i - 1]
        const to = points[i]
        const dx = to.x - from.x
        const dy = to.y - from.y
        const lengthSq = dx * dx + dy * dy
        const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq))
        const distance = Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t))
        if (distance < bestDistance) {
          bestDistance = distance
          bestAlong = cumMm[i - 1] + Math.sqrt(lengthSq) * t
        }
      }

      // Ikkunan ulkopuolelle jäänyt kysely (esim. viivan lopussa) mitataan
      // lähimpään sallittuun kohtaan, jottei se palauta Infinityä.
      if (bestDistance === Infinity) {
        const fallback = pointAt(startMm)
        return { distanceMm: Math.hypot(point.x - fallback.x, point.y - fallback.y), alongMm: startMm }
      }
      return { distanceMm: bestDistance, alongMm: Math.max(startMm, Math.min(endMm, bestAlong)) }
    },
  }
}
