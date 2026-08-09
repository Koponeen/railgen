import type { ResolvedPiece } from './pieces'

// Toleranssibudjetti, ei eksakti sulkeutuminen (CLAUDE.md). BRIO-geometria ei
// sulkeudu matemaattisesti; Vario-jousto (ja valinnainen taipuva pala) nielee
// heiton. README luku 2 antaa oletukset ja turvakaton.

export interface VarioSettings {
  /** Venymä per liitos oletuksena (mm). */
  stretchPerJointMm: number
  /** Taivutus per liitos oletuksena (astetta). */
  bendPerJointDeg: number
  /** Turvakatto per liitos: enempää ei saa syntyä yhteen kohtaan. */
  maxStretchPerJointMm: number
  maxBendPerJointDeg: number
}

export const DEFAULT_VARIO: VarioSettings = {
  stretchPerJointMm: 2,
  bendPerJointDeg: 3,
  maxStretchPerJointMm: 3,
  maxBendPerJointDeg: 5,
}

/** Taipuva pala on käyttäjän oma 3D-tulostettu osa: keskitettyä toleranssia. */
export interface FlexSettings {
  count: number
  minLengthMm: number
  maxLengthMm: number
  maxBendDeg: number
}

export const DEFAULT_FLEX: FlexSettings = {
  count: 0,
  minLengthMm: 100,
  maxLengthMm: 145,
  maxBendDeg: 45,
}

export interface Joint {
  /** Liitoksen jousto suhteessa oletukseen; kaarilla suurempi (R5). */
  varioFactor: number
}

/**
 * Ketjun liitokset. Suljetussa silmukassa liitoksia on yhtä monta kuin paloja,
 * avoimessa ketjussa yksi vähemmän. Liitoksen kerroin on sen kahden palan
 * keskiarvo — kaari–suora-liitos joustaa suora–suora-liitosta enemmän.
 */
export function jointsForChain(pieces: readonly ResolvedPiece[], closed: boolean): Joint[] {
  const joints: Joint[] = []
  const last = closed ? pieces.length : pieces.length - 1
  for (let i = 0; i < last; i += 1) {
    const a = pieces[i]
    const b = pieces[(i + 1) % pieces.length]
    joints.push({ varioFactor: (a.varioFactor + b.varioFactor) / 2 })
  }
  return joints
}

export interface Budget {
  jointCount: number
  /** Kokonaisbudjetti: liitosten jousto + taipuvien palojen jousto. */
  stretchMm: number
  bendDeg: number
  /** Pelkkien liitosten osuus, ilman taipuvia paloja. */
  jointStretchMm: number
  jointBendDeg: number
}

export function loopBudget(joints: readonly Joint[], settings: VarioSettings = DEFAULT_VARIO, flex: FlexSettings = DEFAULT_FLEX): Budget {
  const jointStretchMm = joints.reduce((sum, j) => sum + settings.stretchPerJointMm * j.varioFactor, 0)
  const jointBendDeg = joints.reduce((sum, j) => sum + settings.bendPerJointDeg * j.varioFactor, 0)
  // Taipuva pala on sama virhebudjettimatematiikka, vain isompi budjetti (README luku 2).
  const flexStretchMm = flex.count * Math.max(0, flex.maxLengthMm - flex.minLengthMm)
  const flexBendDeg = flex.count * flex.maxBendDeg
  return {
    jointCount: joints.length,
    jointStretchMm,
    jointBendDeg,
    stretchMm: jointStretchMm + flexStretchMm,
    bendDeg: jointBendDeg + flexBendDeg,
  }
}

export interface ClosureError {
  /** Sauman aukko millimetreinä. */
  gapMm: number
  /** Suuntapoikkeama asteina. */
  angleDeg: number
}

export interface Allocation {
  jointIndex: number
  stretchMm: number
  bendDeg: number
  /** Ylittääkö tämä liitos turvakaton? */
  overCap: boolean
}

export interface ClosureReport {
  budget: Budget
  error: ClosureError
  /** Kulutettu jousto / budjetti, suurempi akseleista. 0–100+ %. */
  tightnessPct: number
  withinBudget: boolean
  /** Kaikki liitokset turvakaton alla? */
  withinCaps: boolean
  ok: boolean
  allocations: Allocation[]
  /** Kuinka paljon jää vajaaksi ("jää 23 mm vajaaksi"). 0 jos budjetti riittää. */
  shortfallMm: number
  shortfallDeg: number
}

/**
 * Jakaa sulkeutumisvirheen liitoksille ja tarkistaa katot. `spread` rajaa
 * jaon sauman lähiliitoksiin (README luku 2: "loppuvirhe jaetaan sauman
 * lähiliitoksille"); 0 = jaetaan koko silmukalle.
 */
export function evaluateClosure(
  joints: readonly Joint[],
  error: ClosureError,
  options: { settings?: VarioSettings; flex?: FlexSettings; seamIndex?: number; spread?: number } = {},
): ClosureReport {
  const settings = options.settings ?? DEFAULT_VARIO
  const flex = options.flex ?? DEFAULT_FLEX
  const budget = loopBudget(joints, settings, flex)

  const indices = selectJoints(joints.length, options.seamIndex ?? 0, options.spread ?? 0)
  const shareTotal = indices.reduce((sum, i) => sum + joints[i].varioFactor, 0)

  const allocations: Allocation[] = indices.map((jointIndex) => {
    const share = shareTotal > 0 ? joints[jointIndex].varioFactor / shareTotal : 0
    const stretchMm = Math.abs(error.gapMm) * share
    const bendDeg = Math.abs(error.angleDeg) * share
    const factor = joints[jointIndex].varioFactor
    const overCap =
      stretchMm > settings.maxStretchPerJointMm * factor + 1e-9 || bendDeg > settings.maxBendPerJointDeg * factor + 1e-9
    return { jointIndex, stretchMm, bendDeg, overCap }
  })

  const usedRatioMm = budget.stretchMm > 0 ? Math.abs(error.gapMm) / budget.stretchMm : Math.abs(error.gapMm) > 0 ? Infinity : 0
  const usedRatioDeg = budget.bendDeg > 0 ? Math.abs(error.angleDeg) / budget.bendDeg : Math.abs(error.angleDeg) > 0 ? Infinity : 0
  const withinBudget = usedRatioMm <= 1 && usedRatioDeg <= 1
  const withinCaps = allocations.every((a) => !a.overCap)

  return {
    budget,
    error,
    tightnessPct: Math.round(Math.max(usedRatioMm, usedRatioDeg) * 100),
    withinBudget,
    withinCaps,
    ok: withinBudget && withinCaps,
    allocations,
    shortfallMm: Math.max(0, Math.abs(error.gapMm) - budget.stretchMm),
    shortfallDeg: Math.max(0, Math.abs(error.angleDeg) - budget.bendDeg),
  }
}

function selectJoints(count: number, seamIndex: number, spread: number): number[] {
  if (count === 0) return []
  if (spread <= 0 || spread >= count) return Array.from({ length: count }, (_, i) => i)
  const picked: number[] = []
  for (let offset = 0; picked.length < spread; offset += 1) {
    const forward = (((seamIndex + offset) % count) + count) % count
    if (!picked.includes(forward)) picked.push(forward)
    if (picked.length >= spread) break
    const backward = (((seamIndex - offset - 1) % count) + count) % count
    if (!picked.includes(backward)) picked.push(backward)
  }
  return picked.sort((a, b) => a - b)
}

/** Montako taipuvaa palaa suljettavat saumat varaavat (README luku 2). */
export function flexReservedForSeams(seamCount: number, flex: FlexSettings): number {
  return Math.min(seamCount, flex.count)
}
