import { describe, expect, it } from 'vitest'
import { deriveSeed, makeRng, seedFromInput, seedFromString, seedToString } from './rng'

describe('rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = makeRng(12345)
    const b = makeRng(12345)
    const first = Array.from({ length: 20 }, () => a.nextUint32())
    const second = Array.from({ length: 20 }, () => b.nextUint32())
    expect(first).toEqual(second)
  })

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 10 }, ((rng) => () => rng.nextUint32())(makeRng(1)))
    const b = Array.from({ length: 10 }, ((rng) => () => rng.nextUint32())(makeRng(2)))
    expect(a).not.toEqual(b)
  })

  it('stays inside [0, 1)', () => {
    const rng = makeRng(7)
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.float()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('keeps int() inside range', () => {
    const rng = makeRng(9)
    for (let i = 0; i < 500; i += 1) {
      const value = rng.int(5)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(5)
    }
  })

  it('derives candidate seeds deterministically from the master seed (R4)', () => {
    const master = 42
    const first = [0, 1, 2, 3, 4].map((i) => deriveSeed(master, i))
    const second = [0, 1, 2, 3, 4].map((i) => deriveSeed(master, i))
    expect(first).toEqual(second)
    expect(new Set(first).size).toBe(first.length)
    expect(deriveSeed(43, 0)).not.toBe(deriveSeed(42, 0))
  })

  it('forks independent but reproducible streams', () => {
    const parent = makeRng(3)
    const a = parent.fork(1).nextUint32()
    const parentAgain = makeRng(3)
    const b = parentAgain.fork(1).nextUint32()
    expect(a).toBe(b)
    expect(makeRng(3).fork(2).nextUint32()).not.toBe(a)
  })

  it('shuffles deterministically without losing items', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const a = makeRng(11).shuffle(items)
    const b = makeRng(11).shuffle(items)
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x - y)).toEqual(items)
  })

  it('respects weights', () => {
    const rng = makeRng(5)
    const picks = Array.from({ length: 200 }, () => rng.weighted(['a', 'b'], [0, 1]))
    expect(new Set(picks)).toEqual(new Set(['b']))
  })

  it('round-trips a seed through its display form', () => {
    const seed = seedFromString('kaisan rata')
    expect(seedFromInput(seedToString(seed))).toBe(seed)
  })

  it('hashes free-form seed text stably', () => {
    expect(seedFromString('rata')).toBe(seedFromString('rata'))
    expect(seedFromString('rata')).not.toBe(seedFromString('rata2'))
  })
})
