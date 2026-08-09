import { describe, expect, it } from 'vitest'
import { defaultLibrary } from './library'
import { DEFAULT_FLEX, DEFAULT_VARIO, evaluateClosure, jointsForChain, loopBudget } from './vario'

const library = defaultLibrary()

function loopOf(ids: string[]) {
  return jointsForChain(ids.map((id) => library.get(id)), true)
}

describe('vario budget', () => {
  it('counts one joint per piece in a closed loop', () => {
    expect(loopOf(['D', 'D', 'D', 'D'])).toHaveLength(4)
    expect(jointsForChain([library.get('D'), library.get('D')], false)).toHaveLength(1)
  })

  it('gives curves a larger factor than straights (R5)', () => {
    const straightLoop = loopBudget(loopOf(['D', 'D', 'D', 'D']))
    const curveLoop = loopBudget(loopOf(['E', 'E', 'E', 'E']))
    expect(curveLoop.stretchMm).toBeGreaterThan(straightLoop.stretchMm)
    expect(straightLoop.stretchMm).toBeCloseTo(4 * DEFAULT_VARIO.stretchPerJointMm, 9)
    expect(curveLoop.stretchMm).toBeCloseTo(4 * DEFAULT_VARIO.stretchPerJointMm * 1.5, 9)
  })

  it('reads the curve factor from the piece library, not from code', () => {
    expect(library.get('E').varioFactor).toBe(1.5)
    expect(library.get('D').varioFactor).toBe(1)
  })

  it('accepts a closure error inside the budget', () => {
    const report = evaluateClosure(loopOf(['E', 'E', 'E', 'E', 'D', 'D', 'D', 'D']), { gapMm: 8, angleDeg: 0 })
    expect(report.ok).toBe(true)
    expect(report.withinBudget).toBe(true)
    expect(report.shortfallMm).toBe(0)
  })

  it('rejects a closure error beyond the budget and reports the shortfall', () => {
    const report = evaluateClosure(loopOf(['D', 'D', 'D', 'D']), { gapMm: 31, angleDeg: 0 })
    expect(report.withinBudget).toBe(false)
    // 4 liitosta x 2 mm = 8 mm budjettia, joten "jää 23 mm vajaaksi".
    expect(report.shortfallMm).toBeCloseTo(23, 9)
  })

  it('reports tightness as consumed flex over budget', () => {
    const report = evaluateClosure(loopOf(['D', 'D', 'D', 'D']), { gapMm: 4, angleDeg: 0 })
    expect(report.tightnessPct).toBe(50)
  })

  it('enforces the per-joint safety cap even when the total fits', () => {
    const joints = loopOf(['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D'])
    const spreadOut = evaluateClosure(joints, { gapMm: 16, angleDeg: 0 })
    expect(spreadOut.ok).toBe(true)

    // Sama virhe pakattuna kahdelle sauman liitokselle ylittää 3 mm:n katon.
    const concentrated = evaluateClosure(joints, { gapMm: 16, angleDeg: 0 }, { seamIndex: 0, spread: 2 })
    expect(concentrated.withinBudget).toBe(true)
    expect(concentrated.withinCaps).toBe(false)
    expect(concentrated.ok).toBe(false)
  })

  it('spreads the error over the joints nearest the seam', () => {
    const joints = loopOf(['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D'])
    const report = evaluateClosure(joints, { gapMm: 4, angleDeg: 0 }, { seamIndex: 0, spread: 4 })
    expect(report.allocations).toHaveLength(4)
    expect(report.allocations.map((a) => a.jointIndex).sort((a, b) => a - b)).toEqual([0, 1, 6, 7])
    expect(report.allocations.reduce((sum, a) => sum + a.stretchMm, 0)).toBeCloseTo(4, 9)
  })

  it('grows the budget when the flex piece is enabled', () => {
    const joints = loopOf(['D', 'D', 'D', 'D'])
    const withoutFlex = evaluateClosure(joints, { gapMm: 31, angleDeg: 0 })
    const withFlex = evaluateClosure(joints, { gapMm: 31, angleDeg: 0 }, { flex: { ...DEFAULT_FLEX, count: 1 } })
    expect(withoutFlex.withinBudget).toBe(false)
    expect(withFlex.withinBudget).toBe(true)
    expect(withFlex.shortfallMm).toBe(0)
  })

  it('tracks the angular budget separately', () => {
    const joints = loopOf(['D', 'D', 'D', 'D'])
    const report = evaluateClosure(joints, { gapMm: 0, angleDeg: 20 })
    expect(report.withinBudget).toBe(false)
    expect(report.shortfallDeg).toBeCloseTo(8, 9)
  })
})
