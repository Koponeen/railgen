import { GestureController } from './gestures'
import { applyView, fitView, lineBBox, render, zoomToBBox } from './render'
import { createInitialState, History, makeLineId, type AppState, type DrawnLine, type Mode, type Point, type ViewTransform } from './state'

// Kartta on imperatiivinen saareke Preactin ulkopuolella
// (docs/IMPLEMENTATION_PLAN.md, vaihe 0). Tämä moduuli omistaa tilan,
// elekäsittelyn ja piirron; Preact-kromi saa vain snapshotin ja callbackit.

export interface MapEngineSnapshot {
  mode: Mode
  canUndo: boolean
  canRedo: boolean
  lineCount: number
  selected: boolean
  zoom: number
}

export interface MapEngineHandle {
  toggleDraw: () => void
  undo: () => void
  redo: () => void
  fit: () => void
}

function snapshotOf(state: AppState, history: History): MapEngineSnapshot {
  return {
    mode: state.mode,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    lineCount: state.lines.length,
    selected: state.selectedId !== null,
    zoom: state.view.scale,
  }
}

export function mountMapEngine(
  container: HTMLElement,
  svg: SVGSVGElement,
  world: SVGGElement,
  onChange: (snapshot: MapEngineSnapshot) => void,
): MapEngineHandle {
  const state: AppState = createInitialState()
  const history = new History(state.lines)
  let draft: Point[] | null = null

  function emit(): void {
    render(world, state, draft)
    onChange(snapshotOf(state, history))
  }

  function animateTo(target: ViewTransform): void {
    world.style.transition = 'transform 240ms ease-out'
    state.view = target
    applyView(world, target)
    window.setTimeout(() => {
      world.style.transition = 'none'
    }, 260)
  }

  function selectLine(id: string): void {
    state.selectedId = id
    const line = state.lines.find((l) => l.id === id)
    if (line) animateTo(zoomToBBox(lineBBox(line)))
    emit()
  }

  function deselectAndFit(): void {
    state.selectedId = null
    animateTo(fitView())
    emit()
  }

  function handleTap(client: { clientX: number; clientY: number }): void {
    const el = document.elementFromPoint(client.clientX, client.clientY)
    const lineEl = el instanceof Element ? el.closest('[data-line-id]') : null
    const id = lineEl?.getAttribute('data-line-id')
    if (id) {
      selectLine(id)
    } else if (state.selectedId) {
      deselectAndFit()
    }
  }

  new GestureController(container, svg, world, {
    getMode: () => state.mode,
    getView: () => state.view,

    onViewPreview(view) {
      world.style.transition = 'none'
      applyView(world, view)
    },
    onViewCommit(view) {
      state.view = view
      emit()
    },

    onDrawStart(point) {
      draft = [point]
      emit()
    },
    onDrawUpdate(points) {
      draft = points
      render(world, state, draft) // nopea polku: ei snapshot-emittiä joka liikkeellä
    },
    onDrawCancel() {
      draft = null
      state.mode = 'view'
      emit()
    },
    onDrawEnd(points) {
      draft = null
      const line: DrawnLine = { id: makeLineId(), points }
      state.lines = [...state.lines, line]
      history.push(state.lines)
      state.mode = 'view' // piirtotila on lyhytikäinen (README luku 7)
      emit()
    },

    onTap: handleTap,
  })

  emit()

  return {
    toggleDraw() {
      state.mode = state.mode === 'draw' ? 'view' : 'draw'
      emit()
    },
    undo() {
      const prev = history.undo()
      if (!prev) return
      state.lines = prev
      state.selectedId = null
      emit()
    },
    redo() {
      const next = history.redo()
      if (!next) return
      state.lines = next
      state.selectedId = null
      emit()
    },
    fit: deselectAndFit,
  }
}
