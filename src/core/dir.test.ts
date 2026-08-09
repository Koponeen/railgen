import { describe, expect, it } from 'vitest'
import { DIR_COUNT, angleDifferenceDeg, dirCos, dirSin, isAxisAligned, isDir, mirrorDir, normalizeDir, oppositeDir, snapDegreesToDir } from './dir'

describe('dir', () => {
  it('keeps axis directions exact so straights stay on the grid', () => {
    expect(dirCos(0)).toBe(1)
    expect(dirSin(0)).toBe(0)
    expect(dirCos(2)).toBe(0)
    expect(dirSin(2)).toBe(1)
    expect(dirCos(4)).toBe(-1)
    expect(dirSin(6)).toBe(-1)
  })

  it('treats every direction as a 45° slot', () => {
    for (let d = 0; d < DIR_COUNT; d += 1) {
      expect(isDir(d)).toBe(true)
    }
    expect(isDir(8)).toBe(false)
    expect(isDir(1.5)).toBe(false)
  })

  it('normalizes out-of-range directions', () => {
    expect(normalizeDir(8)).toBe(0)
    expect(normalizeDir(-1)).toBe(7)
    expect(normalizeDir(-9)).toBe(7)
  })

  it('pairs opposite directions', () => {
    expect(oppositeDir(0)).toBe(4)
    expect(oppositeDir(6)).toBe(2)
    for (let d = 0; d < DIR_COUNT; d += 1) {
      expect(oppositeDir(oppositeDir(d as 0))).toBe(d)
    }
  })

  it('mirrors across the x axis', () => {
    expect(mirrorDir(1)).toBe(7)
    expect(mirrorDir(0)).toBe(0)
    expect(mirrorDir(4)).toBe(4)
  })

  it('flags axis-aligned directions', () => {
    expect(isAxisAligned(0)).toBe(true)
    expect(isAxisAligned(1)).toBe(false)
  })

  it('snaps degrees to slots and reports the residual Vario has to absorb', () => {
    expect(snapDegreesToDir(45)).toEqual({ dir: 1, residualDeg: 0 })
    expect(snapDegreesToDir(-45)).toEqual({ dir: 7, residualDeg: 0 })
    const snapped = snapDegreesToDir(50)
    expect(snapped.dir).toBe(1)
    expect(snapped.residualDeg).toBeCloseTo(5, 9)
  })

  it('wraps angle differences into (-180, 180]', () => {
    expect(angleDifferenceDeg(10, 350)).toBe(20)
    expect(angleDifferenceDeg(350, 10)).toBe(-20)
    expect(angleDifferenceDeg(0, 0)).toBe(0)
  })
})
