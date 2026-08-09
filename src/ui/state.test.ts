import { describe, expect, it } from 'vitest'
import { History, type DrawnLine } from './state'

function line(id: string): DrawnLine {
  return { id, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }
}

describe('History', () => {
  it('starts with nothing to undo or redo', () => {
    const history = new History([])
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
  })

  it('undoes back to the previous snapshot', () => {
    const history = new History([])
    history.push([line('a')])
    history.push([line('a'), line('b')])

    const undone = history.undo()
    expect(undone?.map((l) => l.id)).toEqual(['a'])
    expect(history.canRedo()).toBe(true)
  })

  it('redoes after an undo', () => {
    const history = new History([])
    history.push([line('a')])
    history.undo()

    const redone = history.redo()
    expect(redone?.map((l) => l.id)).toEqual(['a'])
    expect(history.canRedo()).toBe(false)
  })

  it('drops redo history once a new action branches off', () => {
    const history = new History([])
    history.push([line('a')])
    history.push([line('a'), line('b')])
    history.undo()
    history.push([line('a'), line('c')])

    expect(history.canRedo()).toBe(false)
  })
})
