import type { Mode, Point, ViewTransform } from './state'

// README luku 7 "Eleet": universaali sääntö on että kaksi sormea navigoi AINA
// (nipistys = zoom, veto = pan) tilasta riippumatta. Yksi sormi joko panoroi/valitsee
// (katselutila) tai piirtää (piirtotila). Napautus = < ~8 px liikettä ja < ~300 ms.
// Toinen sormi kesken piirron peruu viivan ja siirtyy navigointiin (myös kämmenentunnistus).

const MIN_SCALE = 0.4
const MAX_SCALE = 8
const TAP_MAX_DIST_PX = 8
const TAP_MAX_DURATION_MS = 300

export interface GestureCallbacks {
  getMode: () => Mode
  getView: () => ViewTransform
  /** Eleen aikana: nopea esikatselu (CSS-transform, GPU). */
  onViewPreview: (view: ViewTransform) => void
  /** Eleen päättyessä: lopullinen tila kirjataan sovellustilaan. */
  onViewCommit: (view: ViewTransform) => void
  onDrawStart: (point: Point) => void
  onDrawUpdate: (points: Point[]) => void
  onDrawCancel: () => void
  onDrawEnd: (points: Point[]) => void
  onTap: (client: { clientX: number; clientY: number }) => void
}

interface PointerInfo {
  x: number
  y: number
}

type Phase =
  | { kind: 'idle' }
  | {
      kind: 'pan'
      pointerId: number
      inv: DOMMatrix
      startVB: Point
      baseView: ViewTransform
      startTime: number
      startClient: Point
      moved: boolean
    }
  | {
      kind: 'draw'
      pointerId: number
      points: Point[]
      startTime: number
    }
  | {
      kind: 'nav'
      ids: [number, number]
      inv: DOMMatrix
      startDistPx: number
      baseScale: number
      anchorLocal: Point
    }

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * Käsittelee kaikki Pointer Events -pohjaiset eleet yhdessä paikassa
 * (ei erillistä touch/mouse-koodia, README luku 7 "Tekniikka").
 */
export class GestureController {
  private pointers = new Map<number, PointerInfo>()
  private phase: Phase = { kind: 'idle' }
  private lastView: ViewTransform | null = null

  constructor(
    private container: HTMLElement,
    private svg: SVGSVGElement,
    private world: SVGGElement,
    private cb: GestureCallbacks,
  ) {
    container.addEventListener('pointerdown', this.onDown)
    container.addEventListener('pointermove', this.onMove)
    container.addEventListener('pointerup', this.onUp)
    container.addEventListener('pointercancel', this.onUp)
    // Vain kehityskäytäntö hiiri/trackpad-testaukseen ilman kosketusnäyttöä;
    // varsinainen kohde on kosketusele, ei rullahiiri.
    container.addEventListener('wheel', this.onWheel, { passive: false })
  }

  private screenToViewBox(inv: DOMMatrix, p: Point): Point {
    const svgPt = this.svg.createSVGPoint()
    svgPt.x = p.x
    svgPt.y = p.y
    const t = svgPt.matrixTransform(inv)
    return { x: t.x, y: t.y }
  }

  /** Näyttöpiste maailman (mm) koordinaatistoon nykyisellä pan/zoomilla. */
  private clientToWorld(client: Point): Point {
    const ctm = this.world.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    return this.screenToViewBox(ctm.inverse(), client)
  }

  private preview(view: ViewTransform): void {
    this.lastView = view
    this.cb.onViewPreview(view)
  }

  private onDown = (e: PointerEvent): void => {
    this.container.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this.pointers.size === 1) {
      this.startSinglePointerGesture(e)
    } else if (this.pointers.size === 2) {
      this.startNavGesture()
    }
    // 3.+ sormi: jätetään huomiotta transformilaskuissa, mutta pidetään kirjaa
    // pointers-mapissa jotta tiedetään milloin kaikki sormet ovat irti.
  }

  private startSinglePointerGesture(e: PointerEvent): void {
    const client: Point = { x: e.clientX, y: e.clientY }
    if (this.cb.getMode() === 'draw') {
      const points = [this.clientToWorld(client)]
      this.phase = { kind: 'draw', pointerId: e.pointerId, points, startTime: performance.now() }
      this.cb.onDrawStart(points[0])
      return
    }
    const ctm = this.svg.getScreenCTM()
    if (!ctm) return
    const inv = ctm.inverse()
    this.phase = {
      kind: 'pan',
      pointerId: e.pointerId,
      inv,
      startVB: this.screenToViewBox(inv, client),
      baseView: this.cb.getView(),
      startTime: performance.now(),
      startClient: client,
      moved: false,
    }
    this.lastView = this.cb.getView()
  }

  private startNavGesture(): void {
    if (this.phase.kind === 'draw') {
      this.cb.onDrawCancel()
    }
    const ids = [...this.pointers.keys()].slice(0, 2) as [number, number]
    const p1 = this.pointers.get(ids[0])
    const p2 = this.pointers.get(ids[1])
    const ctm = this.svg.getScreenCTM()
    if (!p1 || !p2 || !ctm) {
      this.phase = { kind: 'idle' }
      return
    }
    const inv = ctm.inverse()
    const startMidPx = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    const startMidVB = this.screenToViewBox(inv, startMidPx)
    const baseView = this.cb.getView()
    // Ankkuripiste maailmakoordinaatistossa: pysyy sormien alla koko eleen ajan.
    const anchorLocal = {
      x: (startMidVB.x - baseView.x) / baseView.scale,
      y: (startMidVB.y - baseView.y) / baseView.scale,
    }
    const startDistPx = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
    this.phase = { kind: 'nav', ids, inv, startDistPx, baseScale: baseView.scale, anchorLocal }
    this.lastView = baseView
  }

  private onMove = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this.phase.kind === 'draw' && e.pointerId === this.phase.pointerId) {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]
      for (const ce of events) {
        this.phase.points.push(this.clientToWorld({ x: ce.clientX, y: ce.clientY }))
      }
      this.cb.onDrawUpdate(this.phase.points.slice())
      return
    }

    if (this.phase.kind === 'pan' && e.pointerId === this.phase.pointerId) {
      const client = { x: e.clientX, y: e.clientY }
      if (Math.hypot(client.x - this.phase.startClient.x, client.y - this.phase.startClient.y) > TAP_MAX_DIST_PX) {
        this.phase.moved = true
      }
      const posVB = this.screenToViewBox(this.phase.inv, client)
      const dx = posVB.x - this.phase.startVB.x
      const dy = posVB.y - this.phase.startVB.y
      this.preview({ x: this.phase.baseView.x + dx, y: this.phase.baseView.y + dy, scale: this.phase.baseView.scale })
      return
    }

    if (this.phase.kind === 'nav') {
      const [id1, id2] = this.phase.ids
      const p1 = this.pointers.get(id1)
      const p2 = this.pointers.get(id2)
      if (!p1 || !p2) return
      const midPx = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      const distPx = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
      const scale = clamp(this.phase.baseScale * (distPx / this.phase.startDistPx), MIN_SCALE, MAX_SCALE)
      const midVB = this.screenToViewBox(this.phase.inv, midPx)
      this.preview({
        x: midVB.x - this.phase.anchorLocal.x * scale,
        y: midVB.y - this.phase.anchorLocal.y * scale,
        scale,
      })
    }
  }

  private onUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return
    this.pointers.delete(e.pointerId)

    if (this.phase.kind === 'draw' && e.pointerId === this.phase.pointerId) {
      const points = this.phase.points
      this.phase = { kind: 'idle' }
      if (points.length >= 2) {
        this.cb.onDrawEnd(points)
      } else {
        this.cb.onDrawCancel()
      }
    } else if (this.phase.kind === 'pan' && e.pointerId === this.phase.pointerId) {
      const duration = performance.now() - this.phase.startTime
      const isTap = !this.phase.moved && duration < TAP_MAX_DURATION_MS
      this.phase = { kind: 'idle' }
      if (isTap) {
        this.cb.onTap({ clientX: e.clientX, clientY: e.clientY })
      } else if (this.lastView) {
        this.cb.onViewCommit(this.lastView)
      }
    } else if (this.phase.kind === 'nav') {
      if (this.lastView) {
        this.cb.onViewCommit(this.lastView)
      }
      const remainingId = this.phase.ids.find((id) => id !== e.pointerId && this.pointers.has(id))
      if (remainingId !== undefined) {
        this.rebaseNavToPan(remainingId)
      } else {
        this.phase = { kind: 'idle' }
      }
    }

    if (this.pointers.size === 0) {
      this.phase = { kind: 'idle' }
      this.lastView = null
    }
  }

  /** Kun pinch/pan-eleestä jää yksi sormi jäljelle, jatketaan panorointina ilman hyppäystä. */
  private rebaseNavToPan(pointerId: number): void {
    const remaining = this.pointers.get(pointerId)
    const ctm = this.svg.getScreenCTM()
    if (!remaining || !ctm) {
      this.phase = { kind: 'idle' }
      return
    }
    const inv = ctm.inverse()
    const client = { x: remaining.x, y: remaining.y }
    const baseView = this.cb.getView()
    this.phase = {
      kind: 'pan',
      pointerId,
      inv,
      startVB: this.screenToViewBox(inv, client),
      baseView,
      startTime: 0, // ei koskaan napautus, ele jatkuu navigoinnista
      startClient: client,
      moved: true,
    }
    this.lastView = baseView
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    const ctm = this.svg.getScreenCTM()
    if (!ctm) return
    const inv = ctm.inverse()
    const pointVB = this.screenToViewBox(inv, { x: e.clientX, y: e.clientY })
    const view = this.cb.getView()
    const anchorLocal = { x: (pointVB.x - view.x) / view.scale, y: (pointVB.y - view.y) / view.scale }
    const scale = clamp(view.scale * Math.exp(-e.deltaY * 0.001), MIN_SCALE, MAX_SCALE)
    const next: ViewTransform = {
      x: pointVB.x - anchorLocal.x * scale,
      y: pointVB.y - anchorLocal.y * scale,
      scale,
    }
    this.cb.onViewPreview(next)
    this.cb.onViewCommit(next)
  }
}
