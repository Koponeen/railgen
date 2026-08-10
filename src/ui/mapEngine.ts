import type { PieceLibrary } from '../core/library'
import type { Track } from '../gen/build'
import type { AreaShape } from '../gen/mask'
import { GestureController } from './gestures'
import { applyView, fitView, render, selectionBBox, zoomToBBox } from './render'
import {
  createInitialState,
  makeLineId,
  type AppState,
  type HandleId,
  type Mode,
  type Ghost,
  type Point,
  type SectionHandles,
  type ViewTransform,
} from './state'

// Kartta on imperatiivinen saareke Preactin ulkopuolella
// (docs/IMPLEMENTATION_PLAN.md luku 2). Tämä moduuli omistaa näkymän,
// elekäsittelyn ja piirron; Preact-kromi saa vain snapshotin ja callbackit.
//
// Osion valinta *ei* asu täällä: kartta korostaa sen mitä sille annetaan ja
// kertoo mihin sormi osui. Rajaussäännöt ovat `src/edit/section.ts`:ssä, jotta
// sama logiikka palvelee myös toimintoriviä ja korvausta.

export interface MapEngineSnapshot {
  zoom: number
  /** Katselu- vai piirtotila; piirto palauttaa tilan itse katseluun. */
  mode: Mode
}

export interface MapEngineContent {
  area: AreaShape
  track: Track | null
  /** Piirretty viiva haaleana radan alla, tai null. */
  guide?: readonly Point[] | null
  /** Korostettava osio radan `pieces`-indekseinä. */
  selection?: readonly number[] | null
  /** Osion liukuvat päätykahvat. */
  handles?: SectionHandles | null
  /** Valittavat vaihtoehdot haamuina radan päällä. */
  ghosts?: readonly Ghost[] | null
  /** Kartta käännetty neljänneskierroksen ruudulle sopimaan. */
  rotated?: boolean
}

export interface MapEngineCallbacks {
  onChange: (snapshot: MapEngineSnapshot) => void
  /** Sormi nousi piirtotilassa: raakapisteet sovitettavaksi. */
  onDraw?: (points: Point[]) => void
  /** Napautus palaan, tai null kun napautus osui tyhjään. */
  onTapPiece?: (index: number | null) => void
  /** Napautus haamuesikatseluun: käyttäjä valitsi sen vaihtoehdon. */
  onTapGhost?: (index: number) => void
  /** Päätykahvaa vedetään: mihin kohtaan maailmaa sormi osoittaa. */
  onHandleMove?: (handle: HandleId, point: Point) => void
  onHandleEnd?: () => void
}

export interface MapEngineHandle {
  /** Vaihtaa näytettävän sisällön ilman uudelleenmounttausta. */
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
  state.rotated = initial.rotated ?? false
  let draft: Point[] | null = null

  function snapshot(): MapEngineSnapshot {
    return { zoom: state.view.scale, mode: state.mode }
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

  function handleTap(client: { clientX: number; clientY: number }): void {
    const element = document.elementFromPoint(client.clientX, client.clientY)
    if (!(element instanceof Element)) {
      callbacks.onTapPiece?.(null)
      return
    }
    // Haamu on radan päällä ja voittaa siksi myös napautuksessa: kysymykseen
    // vastataan ennen kuin karttaa aletaan taas selata.
    const ghost = element.closest('[data-ghost-index]')?.getAttribute('data-ghost-index')
    if (ghost !== null && ghost !== undefined) {
      callbacks.onTapGhost?.(Number(ghost))
      return
    }
    const index = element.closest('[data-piece-index]')?.getAttribute('data-piece-index')
    callbacks.onTapPiece?.(index === null || index === undefined ? null : Number(index))
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

    handleAt(client) {
      if (!state.handles) return null
      const element = document.elementFromPoint(client.clientX, client.clientY)
      const handle = element instanceof Element ? element.closest('[data-handle]') : null
      const id = handle?.getAttribute('data-handle')
      return id === 'start' || id === 'end' ? id : null
    },
    onHandleMove(handle, point) {
      callbacks.onHandleMove?.(handle, point)
    },
    onHandleEnd() {
      callbacks.onHandleEnd?.()
    },
  })

  setGuide(initial.guide)
  emit()

  return {
    update(next) {
      // Näkymä nollataan vain kun kartalla on eri rata tai eri lattia. Osion
      // venytys päivittää sisällön kymmeniä kertoja sekunnissa, eikä kartta saa
      // hypätä sormen alta.
      const moved = state.area !== next.area || state.track !== next.track
      const hadSelection = (state.selection?.length ?? 0) > 0
      const hasSelection = (next.selection?.length ?? 0) > 0

      state.area = next.area
      state.track = next.track
      state.selection = next.selection ?? null
      state.handles = next.handles ?? null
      state.ghosts = next.ghosts ?? []
      state.rotated = next.rotated ?? false
      setGuide(next.guide)
      if (moved) state.view = fitView()
      emit()

      // Valinta → automaattinen zoomaus osuuteen + paluu kokonäkymään
      // (README luku 7). Kesken venytyksen ei zoomata uudelleen.
      if (!moved && hasSelection && !hadSelection) {
        const bbox = selectionBBox(state, library)
        if (bbox) animateTo(zoomToBBox(bbox, state.area))
      } else if (!moved && !hasSelection && hadSelection) {
        animateTo(fitView())
      }
    },
    setMode(mode) {
      if (state.mode === mode) return
      state.mode = mode
      // Tilan vaihto katseluun kesken vedon jättäisi raakaviivan roikkumaan.
      if (mode === 'view') draft = null
      emit()
    },
    fit() {
      animateTo(fitView())
      emit()
    },
    destroy: () => gestures.destroy(),
  }
}
