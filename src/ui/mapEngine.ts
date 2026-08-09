import type { PieceLibrary } from '../core/library'
import type { Track } from '../gen/build'
import type { AreaShape } from '../gen/mask'
import { GestureController } from './gestures'
import { applyView, fitView, pieceBBox, render, zoomToBBox } from './render'
import { createInitialState, makeLineId, type AppState, type Mode, type Point, type ViewTransform } from './state'

// Kartta on imperatiivinen saareke Preactin ulkopuolella
// (docs/IMPLEMENTATION_PLAN.md luku 2). Tämä moduuli omistaa näkymän,
// elekäsittelyn ja piirron; Preact-kromi saa vain snapshotin ja callbackit.

export interface MapEngineSnapshot {
  zoom: number
  /** Valittu pala radan `pieces`-indeksinä, tai null. */
  selectedPiece: number | null
  selectedPieceId: string | null
  /** Katselu- vai piirtotila; piirto palauttaa tilan itse katseluun. */
  mode: Mode
}

export interface MapEngineContent {
  area: AreaShape
  track: Track | null
  /** Piirretty viiva haaleana radan alla, tai null. */
  guide?: readonly Point[] | null
}

export interface MapEngineCallbacks {
  onChange: (snapshot: MapEngineSnapshot) => void
  /** Sormi nousi piirtotilassa: raakapisteet sovitettavaksi. */
  onDraw?: (points: Point[]) => void
}

export interface MapEngineHandle {
  /** Vaihtaa näytettävän radan ja alueen ilman uudelleenmounttausta. */
  update: (next: MapEngineContent) => void
  setMode: (mode: Mode) => void
  fit: () => void
  destroy: () => void
}

export function mountMapEngine(
  container: HTMLElement,
  svg: SVGSVGElement,
  world: SVGGElement,
  library: PieceLibrary,
  initial: MapEngineContent,
  callbacks: MapEngineCallbacks,
): MapEngineHandle {
  const state: AppState = createInitialState(initial.area)
  state.track = initial.track
  let draft: Point[] | null = null

  function snapshot(): MapEngineSnapshot {
    const placed = state.selectedPiece === null ? null : state.track?.pieces[state.selectedPiece]
    return {
      zoom: state.view.scale,
      selectedPiece: state.selectedPiece,
      selectedPieceId: placed?.pieceId ?? null,
      mode: state.mode,
    }
  }

  function emit(): void {
    render(world, state, draft, library)
    callbacks.onChange(snapshot())
  }

  function setGuide(points: readonly Point[] | null | undefined): void {
    state.lines = points && points.length >= 2 ? [{ id: makeLineId(), points: [...points] }] : []
  }

  function animateTo(target: ViewTransform): void {
    world.style.transition = 'transform 240ms ease-out'
    state.view = target
    applyView(world, target)
    window.setTimeout(() => {
      world.style.transition = 'none'
    }, 260)
  }

  function selectPiece(index: number): void {
    state.selectedPiece = index
    const bbox = pieceBBox(state, index, library)
    if (bbox) animateTo(zoomToBBox(bbox, state.area))
    emit()
  }

  function deselectAndFit(): void {
    state.selectedPiece = null
    animateTo(fitView())
    emit()
  }

  function handleTap(client: { clientX: number; clientY: number }): void {
    const element = document.elementFromPoint(client.clientX, client.clientY)
    const pieceElement = element instanceof Element ? element.closest('[data-piece-index]') : null
    const index = pieceElement?.getAttribute('data-piece-index')
    if (index !== null && index !== undefined) {
      selectPiece(Number(index))
    } else if (state.selectedPiece !== null) {
      deselectAndFit()
    }
  }

  const gestures = new GestureController(container, svg, world, {
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

    // Piirtotila on eksplisiittinen ja lyhytikäinen (README luku 7): yksi veto,
    // sitten takaisin katseluun. Toinen sormi peruu vedon ja siirtyy navigointiin.
    onDrawStart(point) {
      draft = [point]
      emit()
    },
    onDrawUpdate(points) {
      draft = points
      render(world, state, draft, library)
    },
    onDrawCancel() {
      draft = null
      state.mode = 'view'
      emit()
    },
    onDrawEnd(points) {
      draft = null
      state.mode = 'view'
      emit()
      callbacks.onDraw?.(points)
    },

    onTap: handleTap,
  })

  setGuide(initial.guide)
  emit()

  return {
    update(next) {
      state.area = next.area
      state.track = next.track
      state.selectedPiece = null
      state.view = fitView()
      setGuide(next.guide)
      emit()
    },
    setMode(mode) {
      if (state.mode === mode) return
      state.mode = mode
      // Tilan vaihto katseluun kesken vedon jättäisi raakaviivan roikkumaan.
      if (mode === 'view') draft = null
      emit()
    },
    fit: deselectAndFit,
    destroy: () => gestures.destroy(),
  }
}
