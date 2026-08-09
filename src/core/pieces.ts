import { isDir, mirrorDir, normalizeDir, oppositeDir, snapDegreesToDir, type Dir } from './dir'
import {
  footprintPolygon,
  pathLength,
  polygonBBox,
  segmentEnd,
  toSvgPath,
  transformSegment,
  unionBBox,
  type BBox,
  type Segment,
} from './path'
import { complementOf, portSignatures, transformPort, type Connector, type Port } from './ports'
import { EPS_DEG, EPS_MM, LEVEL_RISE_MM, isOnMicroGrid } from './units'
import { mirrorVec, rotateVec, transformPoint, type Placement, type Vec } from './vec'

// Palakirjasto on dataa, ei koodia (CLAUDE.md). Koodi tulkitsee kolme palatasoa
// (parametrinen / yhdistelmä / erikois, README luku 8), mutta yksittäinen uusi
// pala ei koskaan vaadi kooditiedoston muutosta.

export type PieceKind = 'straight' | 'curve' | 'ramp' | 'terminal' | 'junction' | 'composite' | 'custom'

interface PieceCommonSpec {
  id: string
  /** Vario-kerroin: kuinka paljon tämän palan liitokset joustavat (R5). */
  varioFactor?: number
  /** Saako palan kääntää nurin (kaaret kelpaavat sekä vasempaan että oikeaan mutkaan)? */
  mirrorable?: boolean
  tags?: string[]
  /** Pienin taso, jolla pala on sallittu (sillan kansi vaatii tason 1). */
  minLevel?: number
  /** Mistä mitat on tarkistettu. */
  source?: string
  notes?: string
}

export interface StraightSpec extends PieceCommonSpec {
  kind: 'straight'
  lengthMm: number
  /**
   * Liittimet [sisääntulo, ulostulo]. Oletus kolo -> tappi. BRIO myy myös
   * sukupuolivariantteja (B/C, B1/C1, B2/C2), joilla molemmat päät ovat samat;
   * ne ovat ainoa tapa kääntää silmukan liitinparillisuus.
   */
  connectors?: [Connector, Connector]
}

export interface CurveSpec extends PieceCommonSpec {
  kind: 'curve'
  /** Keskilinjasäde. */
  radiusMm: number
  sweepDeg: number
  hand: 'left' | 'right'
  innerRadiusMm?: number
}

export interface RampSpec extends PieceCommonSpec {
  kind: 'ramp'
  lengthMm: number
  riseMm: number
  connectors?: [Connector, Connector]
}

/** Umpipää: puskuri tai ajoramppi. Vain yksi portti. */
export interface TerminalSpec extends PieceCommonSpec {
  kind: 'terminal'
  lengthMm: number
  connector: Connector
}

/** Reitin askel: suora tai kaari. Kaikki kaaret ovat 45°:n monikertoja. */
export type PathStep = { straight: number } | { curve: { radiusMm: number; sweepDeg: number; hand: 'left' | 'right' } }

export interface RoutePortSpec {
  id: string
  connector: Connector
  branch?: boolean
  levelOffset?: number
}

export interface RouteSpec {
  /** Reitin alkuasento palan koordinaatistossa. Oletus origo suuntaan 0. */
  start?: { x?: number; y?: number; dir?: number }
  from: RoutePortSpec
  to: RoutePortSpec
  path: PathStep[]
}

/**
 * Vaihde tai risteys: joukko reittejä, joista portit johdetaan automaattisesti.
 * Reitit saavat jakaa portteja (vaihteen haarat lähtevät samasta sisääntulosta),
 * jolloin resolvointi tarkistaa että jaetun portin sijainti täsmää — käsin
 * lasketut koordinaatit eivät siis pääse ristiriitaan keskenään.
 */
export interface JunctionSpec extends PieceCommonSpec {
  kind: 'junction'
  routes: RouteSpec[]
}

export interface CompositePartSpec {
  piece: string
  /** Mihin jo koottuun porttiin osa liitetään. Puuttuva = ensimmäinen osa origoon. */
  join?: { toPort: string; entryPort?: string }
  mirror?: boolean
  /** Portin uudelleennimeäminen kokoonpanossa, esim. { "out": "branch" }. */
  rename?: Record<string, string>
  /** Portit, jotka merkitään haaraporteiksi (eivät kuulu korvausluokkaan). */
  branchPorts?: string[]
}

export interface CompositeSpec extends PieceCommonSpec {
  kind: 'composite'
  parts: CompositePartSpec[]
}

export interface PortSpec {
  id: string
  x: number
  y: number
  dir: number
  connector: Connector
  levelOffset?: number
  branch?: boolean
}

export interface CustomSpec extends PieceCommonSpec {
  kind: 'custom'
  ports: PortSpec[]
  /** Keskilinja segmentteinä; jos puuttuu, käytetään pelkkää pathDataa piirtoon. */
  segments?: Segment[]
  /** Oma piirtopolku SVG-polkudatana — dataa, ei koodia (R3). */
  pathData?: string
  /** Jalanjälki monikulmioina, jos sitä ei voi johtaa keskilinjasta. */
  footprint?: Vec[][]
  /** Keskilinjan pituus, jos segmenttejä ei ole annettu. */
  lengthMm?: number
}

export type PieceSpec = StraightSpec | CurveSpec | RampSpec | TerminalSpec | JunctionSpec | CompositeSpec | CustomSpec

export interface ResolvedPiece {
  id: string
  kind: PieceKind
  ports: Port[]
  /** Ei-haaraportit. Korvausluokka lasketaan näistä (R8 / README luku 2). */
  mainPorts: Port[]
  segments: Segment[]
  /** Pääreitin keskilinjan pituus millimetreinä (radan pituus lasketaan tästä). */
  lengthMm: number
  /** Kaikkien reittien yhteispituus; vaihteella suurempi kuin `lengthMm`. */
  totalLengthMm: number
  /** Umpipää: vain yksi portti, ketju päättyy tähän. */
  isTerminal: boolean
  /** Suoran nimellispituus, jos pala on suora tai ramppi; muuten null. */
  straightLengthMm: number | null
  footprint: Vec[][]
  bbox: BBox
  /** Tasomuutos palan läpi (N-ramppi = 1). */
  levelDelta: number
  varioFactor: number
  mirrorable: boolean
  minLevel: number
  tags: string[]
  /** Korvausluokan avaimet: sama avain = vaihtokelpoinen pala. */
  signatures: string[]
  pathData: string
  source?: string
}

const DEFAULT_VARIO_FACTOR: Record<PieceKind, number> = {
  straight: 1,
  curve: 1.5,
  ramp: 1,
  terminal: 1,
  junction: 1,
  composite: 1,
  custom: 1,
}

function makePort(spec: PortSpec): Port {
  if (!isDir(spec.dir)) {
    throw new RangeError(`port "${spec.id}": direction ${spec.dir} is not a 45° slot (0..7)`)
  }
  return {
    id: spec.id,
    x: spec.x,
    y: spec.y,
    dir: spec.dir,
    connector: spec.connector,
    levelOffset: spec.levelOffset ?? 0,
    branch: spec.branch ?? false,
  }
}

// --- Taso 1: parametriset palat ---------------------------------------------

function straightGeometry(lengthMm: number, riseLevels: number): { ports: Port[]; segments: Segment[] } {
  return {
    ports: [
      makePort({ id: 'in', x: 0, y: 0, dir: 4, connector: 'socket' }),
      makePort({ id: 'out', x: lengthMm, y: 0, dir: 0, connector: 'pin', levelOffset: riseLevels }),
    ],
    segments: [{ type: 'line', from: { x: 0, y: 0 }, to: { x: lengthMm, y: 0 } }],
  }
}

function curveGeometry(spec: CurveSpec): { ports: Port[]; segments: Segment[] } {
  const sign = spec.hand === 'right' ? 1 : -1
  const arc: Segment = {
    type: 'arc',
    center: { x: 0, y: sign * spec.radiusMm },
    radiusMm: spec.radiusMm,
    startDeg: sign * -90,
    sweepDeg: sign * spec.sweepDeg,
  }
  const end = segmentEnd(arc)
  const exit = snapDegreesToDir(sign * spec.sweepDeg)
  if (Math.abs(exit.residualDeg) > EPS_DEG) {
    throw new RangeError(`curve "${spec.id}": ${spec.sweepDeg}° does not land on a 45° slot`)
  }
  return {
    ports: [
      makePort({ id: 'in', x: 0, y: 0, dir: 4, connector: 'socket' }),
      makePort({ id: 'out', x: end.x, y: end.y, dir: exit.dir, connector: 'pin' }),
    ],
    segments: [arc],
  }
}

function straightPorts(lengthMm: number, riseLevels: number, connectors: [Connector, Connector]): Port[] {
  return [
    makePort({ id: 'in', x: 0, y: 0, dir: 4, connector: connectors[0] }),
    makePort({ id: 'out', x: lengthMm, y: 0, dir: 0, connector: connectors[1], levelOffset: riseLevels }),
  ]
}

// --- Taso 2: vaihteet ja risteykset reitteinä --------------------------------

/** Kulkee yhden reitin läpi ja palauttaa segmentit sekä loppuasennon. */
function walkRoute(pieceId: string, route: RouteSpec): { segments: Segment[]; start: Vec; startDir: Dir; end: Vec; endDir: Dir } {
  const start: Vec = { x: route.start?.x ?? 0, y: route.start?.y ?? 0 }
  const startDirRaw = route.start?.dir ?? 0
  if (!isDir(startDirRaw)) throw new RangeError(`piece "${pieceId}": route start direction ${startDirRaw} is not a 45° slot`)

  let position = start
  let heading: Dir = startDirRaw
  const segments: Segment[] = []

  for (const step of route.path) {
    const placement: Placement = { x: position.x, y: position.y, rot: heading, mirror: false, level: 0 }
    if ('straight' in step) {
      const local: Segment = { type: 'line', from: { x: 0, y: 0 }, to: { x: step.straight, y: 0 } }
      const segment = transformSegment(local, placement)
      segments.push(segment)
      position = segmentEnd(segment)
    } else {
      const { radiusMm, sweepDeg, hand } = step.curve
      const slots = sweepDeg / 45
      if (!Number.isInteger(slots)) throw new RangeError(`piece "${pieceId}": curve sweep ${sweepDeg}° is not a multiple of 45°`)
      const sign = hand === 'right' ? 1 : -1
      const local: Segment = {
        type: 'arc',
        center: { x: 0, y: sign * radiusMm },
        radiusMm,
        startDeg: sign * -90,
        sweepDeg: sign * sweepDeg,
      }
      const segment = transformSegment(local, placement)
      segments.push(segment)
      position = segmentEnd(segment)
      heading = normalizeDir(heading + sign * slots)
    }
  }

  return { segments, start, startDir: startDirRaw, end: position, endDir: heading }
}

function resolveJunction(spec: JunctionSpec): { ports: Port[]; segments: Segment[]; routeLengths: Map<string, number> } {
  const ports = new Map<string, Port>()
  const segments: Segment[] = []
  const routeLengths = new Map<string, number>()

  const define = (portSpec: RoutePortSpec, at: Vec, dir: Dir): void => {
    const port = makePort({
      id: portSpec.id,
      x: at.x,
      y: at.y,
      dir,
      connector: portSpec.connector,
      levelOffset: portSpec.levelOffset ?? 0,
      branch: portSpec.branch ?? false,
    })
    const existing = ports.get(portSpec.id)
    if (!existing) {
      ports.set(portSpec.id, port)
      return
    }
    // Jaettu portti: reittien on päädyttävä samaan paikkaan samalla liittimellä,
    // muuten data on ristiriitainen itsensä kanssa.
    if (Math.abs(existing.x - port.x) > EPS_MM || Math.abs(existing.y - port.y) > EPS_MM || existing.dir !== port.dir) {
      throw new RangeError(
        `piece "${spec.id}": port "${portSpec.id}" is reached at (${port.x.toFixed(2)}, ${port.y.toFixed(2)}) dir ${port.dir}` +
          ` but was already defined at (${existing.x.toFixed(2)}, ${existing.y.toFixed(2)}) dir ${existing.dir}`,
      )
    }
    if (existing.connector !== port.connector) {
      throw new RangeError(`piece "${spec.id}": port "${portSpec.id}" is declared as both "${existing.connector}" and "${port.connector}"`)
    }
    if (existing.branch !== port.branch) {
      throw new RangeError(`piece "${spec.id}": port "${portSpec.id}" is declared both as a branch and as a main port`)
    }
  }

  for (const route of spec.routes) {
    const walked = walkRoute(spec.id, route)
    segments.push(...walked.segments)
    define(route.from, walked.start, oppositeDir(walked.startDir))
    define(route.to, walked.end, walked.endDir)
    routeLengths.set(`${route.from.id}->${route.to.id}`, pathLength(walked.segments))
  }

  return { ports: [...ports.values()], segments, routeLengths }
}

// --- Taso 3: yhdistelmäpalat -------------------------------------------------

/** Sijoitus, jolla palan `entry`-portti liittyy jo koottuun `target`-porttiin. */
export function placementForMate(entry: Port, target: Port, mirror: boolean, level = 0): Placement {
  const entryDir = mirror ? mirrorDir(entry.dir) : entry.dir
  const entryPos = mirror ? mirrorVec({ x: entry.x, y: entry.y }) : { x: entry.x, y: entry.y }
  const rot = normalizeDir(oppositeDir(target.dir) - entryDir)
  const rotated = rotateVec(entryPos, rot)
  return { x: target.x - rotated.x, y: target.y - rotated.y, rot, mirror, level }
}

function resolveComposite(spec: CompositeSpec, library: Map<string, ResolvedPiece>): { ports: Port[]; segments: Segment[] } {
  const openPorts = new Map<string, Port>()
  const segments: Segment[] = []

  spec.parts.forEach((part, index) => {
    const base = library.get(part.piece)
    if (!base) throw new ReferenceError(`composite "${spec.id}": unknown part piece "${part.piece}"`)

    let placement: Placement
    if (index === 0) {
      if (part.join) throw new RangeError(`composite "${spec.id}": the first part must not declare a join`)
      placement = { x: 0, y: 0, rot: 0, mirror: part.mirror ?? false, level: 0 }
    } else {
      if (!part.join) throw new RangeError(`composite "${spec.id}": part ${index} must declare a join`)
      const target = openPorts.get(part.join.toPort)
      if (!target) throw new ReferenceError(`composite "${spec.id}": no open port "${part.join.toPort}"`)
      const entryId = part.join.entryPort ?? base.mainPorts[0].id
      const entry = base.ports.find((p) => p.id === entryId)
      if (!entry) throw new ReferenceError(`composite "${spec.id}": part "${part.piece}" has no port "${entryId}"`)
      if (entry.connector !== complementOf(target.connector)) {
        throw new RangeError(`composite "${spec.id}": connector mismatch at "${part.join.toPort}"`)
      }
      placement = placementForMate(entry, target, part.mirror ?? false)
      openPorts.delete(part.join.toPort)
    }

    for (const segment of base.segments) segments.push(transformSegment(segment, placement))

    for (const port of base.ports) {
      if (index > 0 && part.join && port.id === (part.join.entryPort ?? base.mainPorts[0].id)) continue
      const world = transformPort(port, placement)
      const name = part.rename?.[port.id] ?? (spec.parts.length > 1 ? `${part.piece.toLowerCase()}${index}.${port.id}` : port.id)
      openPorts.set(name, {
        ...world,
        id: name,
        branch: world.branch || (part.branchPorts?.includes(port.id) ?? false),
      })
    }
  })

  return { ports: [...openPorts.values()], segments }
}

// --- Ratkaisu ----------------------------------------------------------------

export function resolvePiece(spec: PieceSpec, library: Map<string, ResolvedPiece>): ResolvedPiece {
  let ports: Port[]
  let segments: Segment[]
  let footprint: Vec[][] | null = null
  let explicitLength: number | null = null
  let explicitPath: string | null = null

  let routeLengths: Map<string, number> | null = null

  switch (spec.kind) {
    case 'straight': {
      ports = straightPorts(spec.lengthMm, 0, spec.connectors ?? ['socket', 'pin'])
      segments = straightGeometry(spec.lengthMm, 0).segments
      break
    }
    case 'ramp': {
      const levels = spec.riseMm / LEVEL_RISE_MM
      if (Math.abs(levels - Math.round(levels)) > 1e-9) {
        throw new RangeError(`ramp "${spec.id}": rise ${spec.riseMm} mm is not a multiple of ${LEVEL_RISE_MM} mm`)
      }
      ports = straightPorts(spec.lengthMm, Math.round(levels), spec.connectors ?? ['socket', 'pin'])
      segments = straightGeometry(spec.lengthMm, 0).segments
      break
    }
    case 'terminal': {
      ports = [makePort({ id: 'in', x: 0, y: 0, dir: 4, connector: spec.connector })]
      segments = straightGeometry(spec.lengthMm, 0).segments
      break
    }
    case 'junction': {
      const geometry = resolveJunction(spec)
      ports = geometry.ports
      segments = geometry.segments
      routeLengths = geometry.routeLengths
      break
    }
    case 'curve': {
      const geometry = curveGeometry(spec)
      ports = geometry.ports
      segments = geometry.segments
      break
    }
    case 'composite': {
      const geometry = resolveComposite(spec, library)
      ports = geometry.ports
      segments = geometry.segments
      break
    }
    case 'custom': {
      ports = spec.ports.map(makePort)
      segments = spec.segments ?? []
      footprint = spec.footprint ?? null
      explicitLength = spec.lengthMm ?? null
      explicitPath = spec.pathData ?? null
      break
    }
  }

  const mainPorts = ports.filter((port) => !port.branch)
  const isTerminal = spec.kind === 'terminal'
  const mirrorable =
    spec.mirrorable ?? (spec.kind === 'straight' || spec.kind === 'curve' || spec.kind === 'ramp' || spec.kind === 'terminal')
  const resolvedFootprint = footprint ?? (segments.length > 0 ? [footprintPolygon(segments)] : [])
  const bbox = resolvedFootprint.length > 0 ? unionBBox(resolvedFootprint.map(polygonBBox)) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  // Umpipäätä ei koskaan käytetä välin täyttöön, joten sitä ei mitata suorana
  // (esim. puskuri on 40 mm eikä osu mikrogridiin).
  const straightLengthMm = spec.kind === 'straight' || spec.kind === 'ramp' ? spec.lengthMm : null

  // Vaihteen pituus radalla on sen pääreitin pituus, ei kaikkien reittien summa.
  const totalLengthMm = explicitLength ?? pathLength(segments)
  const mainRouteLength =
    routeLengths && mainPorts.length === 2
      ? routeLengths.get(`${mainPorts[0].id}->${mainPorts[1].id}`) ?? routeLengths.get(`${mainPorts[1].id}->${mainPorts[0].id}`)
      : undefined

  return {
    id: spec.id,
    kind: spec.kind,
    ports,
    mainPorts,
    segments,
    lengthMm: mainRouteLength ?? totalLengthMm,
    totalLengthMm,
    isTerminal,
    straightLengthMm,
    footprint: resolvedFootprint,
    bbox,
    levelDelta: Math.max(0, ...ports.map((p) => p.levelOffset)) - Math.min(0, ...ports.map((p) => p.levelOffset)),
    varioFactor: spec.varioFactor ?? DEFAULT_VARIO_FACTOR[spec.kind],

    mirrorable,
    minLevel: spec.minLevel ?? 0,
    tags: spec.tags ?? [],
    // Korvausluokka lasketaan vain pääporteista, joten haarapalat (T, X, vaihteet)
    // liittyvät automaattisesti läpimenevän suoransa luokkaan.
    signatures: portSignatures(mainPorts, mirrorable),
    pathData: explicitPath ?? toSvgPath(segments),
    source: spec.source,
  }
}

export interface PieceProblem {
  pieceId: string
  code: string
  detail: string
}

/** Palakirjaston validointi (README luku 8): portit, gridi, liittimet. */
export function validatePiece(piece: ResolvedPiece): PieceProblem[] {
  const problems: PieceProblem[] = []
  const push = (code: string, detail: string) => problems.push({ pieceId: piece.id, code, detail })

  // Umpipäällä (puskuri, ajoramppi) on tarkoituksella vain yksi portti.
  const expectedMainPorts = piece.isTerminal ? 1 : 2
  if (piece.ports.length < expectedMainPorts) push('too-few-ports', `${piece.ports.length} port(s)`)
  if (piece.mainPorts.length !== expectedMainPorts) {
    push('main-span', `${piece.mainPorts.length} non-branch ports, expected ${expectedMainPorts}`)
  }

  const ids = new Set<string>()
  for (const port of piece.ports) {
    if (ids.has(port.id)) push('duplicate-port', port.id)
    ids.add(port.id)
    if (!isDir(port.dir)) push('port-direction', `${port.id} dir=${port.dir}`)
    if (!Number.isFinite(port.x) || !Number.isFinite(port.y)) push('port-position', port.id)
  }

  if (piece.straightLengthMm !== null && !piece.tags.includes('off-grid') && !isOnMicroGrid(piece.straightLengthMm)) {
    push('off-grid', `${piece.straightLengthMm} mm is not a multiple of 18 mm`)
  }

  if (piece.mainPorts.length === 2) {
    const [a, b] = piece.mainPorts
    if (a.connector === b.connector && !piece.tags.includes('symmetric-connectors')) {
      push('connectors', `both main ports are "${a.connector}"`)
    }
  }

  return problems
}

// --- Sijoittelu --------------------------------------------------------------

export interface PlaceOptions {
  mirror?: boolean
  entryPortId?: string
  exitPortId?: string
  allowConnectorFlip?: boolean
}

export interface PlacedPiece {
  pieceId: string
  placement: Placement
  entryPortId: string
  exitPortId: string
}

export interface Frame {
  x: number
  y: number
  dir: Dir
  level: number
  /** Avoimen pään liitin: seuraavan palan sisääntuloportin on oltava tämän vastapari. */
  open: Connector
}

export function startFrame(x: number, y: number, dir: Dir, level = 0, open: Connector = 'pin'): Frame {
  return { x, y, dir, level, open }
}

/**
 * Sijoittaa palan niin, että sen sisääntuloportti liittyy kohdistimeen, ja
 * palauttaa uuden kohdistimen. Palauttaa null, jos liitin tai taso ei kelpaa —
 * kutsuja hylkää yrityksen siististi (CLAUDE.md: rata on aina ehjä).
 */
export function placeAtFrame(
  piece: ResolvedPiece,
  frame: Frame,
  options: PlaceOptions = {},
): { placed: PlacedPiece; exit: Frame } | null {
  const entryId = options.entryPortId ?? piece.mainPorts[0]?.id
  const entry = piece.ports.find((p) => p.id === entryId)
  if (!entry) return null

  const exitId = options.exitPortId ?? piece.mainPorts.find((p) => p.id !== entryId)?.id
  const exit = piece.ports.find((p) => p.id === exitId)
  if (!exit || exit.id === entry.id) return null

  if (!options.allowConnectorFlip && entry.connector !== complementOf(frame.open)) return null

  const mirror = options.mirror ?? false
  const target: Port = { id: 'cursor', x: frame.x, y: frame.y, dir: frame.dir, connector: frame.open, levelOffset: 0, branch: false }
  const placement = placementForMate(entry, target, mirror, frame.level - entry.levelOffset)
  if (placement.level < piece.minLevel) return null

  const worldExit = transformPort(exit, placement)
  return {
    placed: { pieceId: piece.id, placement, entryPortId: entry.id, exitPortId: exit.id },
    exit: { x: worldExit.x, y: worldExit.y, dir: worldExit.dir, level: worldExit.levelOffset, open: exit.connector },
  }
}

/**
 * Sijoittaa umpipään (puskuri tai ajoramppi) kohdistimeen. Ketju päättyy tähän,
 * joten uutta kohdistinta ei synny.
 */
export function placeTerminal(piece: ResolvedPiece, frame: Frame, options: PlaceOptions = {}): PlacedPiece | null {
  const entry = piece.ports.find((port) => port.id === (options.entryPortId ?? piece.mainPorts[0]?.id))
  if (!entry) return null
  if (!options.allowConnectorFlip && entry.connector !== complementOf(frame.open)) return null

  const target: Port = { id: 'cursor', x: frame.x, y: frame.y, dir: frame.dir, connector: frame.open, levelOffset: 0, branch: false }
  const placement = placementForMate(entry, target, options.mirror ?? false, frame.level - entry.levelOffset)
  if (placement.level < piece.minLevel) return null
  return { pieceId: piece.id, placement, entryPortId: entry.id, exitPortId: entry.id }
}

/**
 * Kehys, johon pala on sijoitettu: sen sisääntuloportti maailmakoordinaatistossa,
 * käännettynä takaisin kohdistimeksi. `placeAtFrame(piece, entryFrame(placed))`
 * palauttaa saman sijoituksen, joten valmiin radan ketjun voi kulkea kumpaan
 * suuntaan tahansa ilman että sijoitushistoriaa tarvitsee säilyttää.
 */
export function entryFrame(placed: PlacedPiece, piece: ResolvedPiece): Frame {
  const port = worldPort(placed, piece, placed.entryPortId)
  return { x: port.x, y: port.y, dir: oppositeDir(port.dir), level: port.levelOffset, open: complementOf(port.connector) }
}

/** Kehys palan jälkeen: sama jonka `placeAtFrame` palauttaa ulostulona. */
export function exitFrame(placed: PlacedPiece, piece: ResolvedPiece): Frame {
  const port = worldPort(placed, piece, placed.exitPortId)
  return { x: port.x, y: port.y, dir: port.dir, level: port.levelOffset, open: port.connector }
}

function worldPort(placed: PlacedPiece, piece: ResolvedPiece, portId: string): Port {
  const port = piece.ports.find((candidate) => candidate.id === portId)
  if (!port) throw new ReferenceError(`piece "${piece.id}" has no port "${portId}"`)
  return transformPort(port, placed.placement)
}

export function placedSegments(placed: PlacedPiece, piece: ResolvedPiece): Segment[] {
  return piece.segments.map((segment) => transformSegment(segment, placed.placement))
}

export function placedFootprint(placed: PlacedPiece, piece: ResolvedPiece): Vec[][] {
  return piece.footprint.map((polygon) => polygon.map((point) => transformPoint(point, placed.placement)))
}

export function placedBBox(placed: PlacedPiece, piece: ResolvedPiece): BBox {
  const polygons = placedFootprint(placed, piece)
  if (polygons.length === 0) return { minX: placed.placement.x, minY: placed.placement.y, maxX: placed.placement.x, maxY: placed.placement.y }
  return unionBBox(polygons.map(polygonBBox))
}

export function placedPorts(placed: PlacedPiece, piece: ResolvedPiece): Port[] {
  return piece.ports.map((port) => transformPort(port, placed.placement))
}

export { EPS_MM }
