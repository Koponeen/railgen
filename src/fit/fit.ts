import { angleDifferenceDeg, dirToDegrees } from '../core/dir'
import { shortagesAgainst, unlimitedInventory, type Inventory } from '../core/inventory'
import { defaultLibrary, type PieceLibrary } from '../core/library'
import type { PlacedPiece } from '../core/pieces'
import type { Vec } from '../core/vec'
import { evaluateClosure, jointsForChain, type ClosureReport, type FlexSettings, type VarioSettings } from '../core/vario'
import { countCollisions, relaxClosure, summariseTrack, type Track } from '../gen/build'
import { areaBounds, buildMask, type AreaShape } from '../gen/mask'
import { beamFit, type BeamFit, type FitTuning } from './beam'
import { cleanDrawing, MIN_DRAWING_LENGTH_MM, type CleanOptions } from './simplify'
import { buildTarget } from './target'

// Piirtotila (README luku 5): piirretty viiva on vaihtoehtoinen rungon lähde ja
// sama alavirta kuin satunnaisgeneroinnissa. Siivous -> keilahakusovitus ->
// sulkeutuminen budjettiin -> inventaarion tarkistus.

export type FitReason =
  | 'ok'
  | 'drawing-too-short'
  | 'no-fit'
  | 'closure-beyond-budget'
  | 'joint-over-safety-cap'
  | 'self-collision'

export interface FitOptions {
  area: AreaShape
  library?: PieceLibrary
  inventory?: Inventory
  vario?: VarioSettings
  flex?: FlexSettings
  allowConnectorFlip?: boolean
  tuning?: Partial<FitTuning>
  clean?: CleanOptions
}

export interface FitResult {
  /** Sovitettu rata, tai null jos sovitus ei onnistunut. */
  track: Track | null
  reason: FitReason
  /** Tulkittiinko piirretty viiva silmukaksi? */
  closed: boolean
  /** Kuinka kaukana valmis rata kulkee piirretystä viivasta. */
  deviation: { meanMm: number; maxMm: number }
  /**
   * Mahtuiko rata inventaarioon. Jos ei, rata sovitettiin rajattomilla paloilla
   * ja `track.shortages` kertoo mitä pitäisi hankkia lisää (README luku 5).
   */
  withinInventory: boolean
}

function failure(reason: FitReason, closed = false): FitResult {
  return { track: null, reason, closed, deviation: { meanMm: 0, maxMm: 0 }, withinInventory: true }
}

/**
 * Sovittaa vapaalla kädellä piirretyn viivan paloiksi.
 *
 * Inventaario tarkistetaan kahdessa vaiheessa: ensin sovitetaan käyttäjän
 * omilla paloilla, ja vasta jos se ei onnistu, sovitetaan rajattomilla ja
 * raportoidaan puuttuvat palat. Näin oman kokoelman rajoissa pysyvä rata
 * voittaa aina, mutta käyttäjä saa silti rehellisen vastauksen.
 */
export function fitDrawing(rawPoints: readonly Vec[], options: FitOptions): FitResult {
  const library = options.library ?? defaultLibrary()
  const inventory = options.inventory ?? unlimitedInventory()

  const drawing = cleanDrawing(rawPoints, options.clean)
  if (!drawing || drawing.lengthMm < MIN_DRAWING_LENGTH_MM) return failure('drawing-too-short', drawing?.closed ?? false)

  const target = buildTarget(drawing)
  const bounds = areaBounds(buildMask(options.area))

  const attempt = (attemptInventory: Inventory): FitResult | null => {
    const fits = beamFit(target, {
      library,
      inventory: attemptInventory,
      tuning: options.tuning,
      allowConnectorFlip: options.allowConnectorFlip,
    })
    let firstReason: FitReason | null = null
    const built: { track: Track; fit: BeamFit }[] = []

    for (const fit of fits) {
      const assembled = assemble(fit, library, inventory, bounds, target.closed, options)
      if (assembled.track) built.push({ track: assembled.track, fit })
      else firstReason ??= assembled.reason
    }

    if (built.length === 0) {
      // Kaikki ketjut kaatuivat samaan esteeseen: kerrotaan se, ei yleistä "ei sovi".
      return firstReason ? failure(firstReason, target.closed) : null
    }

    // Ketjut tulevat keilahausta sovituskustannuksen mukaan, mikä ratkaisee
    // avoimen viivan. Silmukassa ratkaisee sauma, ja sen kaksi virhettä ovat
    // eriarvoisia: pituusheiton `relaxClosure` jakaa liitoksille niin että
    // silmukka sulkeutuu myös kuvassa, mutta suuntaheittoa se ei voi jakaa —
    // sijoituksen kierto on kokonainen 45°:n lokero. Jäljelle jäävä suuntaero
    // näkyisi mutkana sauman kohdalla, joten se painaa enemmän kuin kireys.
    // Vakaa lajittelu pitää sovituskustannuksen tasapelien ratkaisijana.
    if (target.closed) {
      built.sort(
        (a, b) =>
          Math.abs(a.track.closure.error.angleDeg) - Math.abs(b.track.closure.error.angleDeg) ||
          a.track.closure.tightnessPct - b.track.closure.tightnessPct,
      )
    }
    const best = built[0]

    return {
      track: best.track,
      reason: 'ok',
      closed: target.closed,
      deviation: best.fit.deviation,
      withinInventory: attemptInventory === inventory,
    }
  }

  const own = attempt(inventory)
  if (own?.track) return own
  if (inventory.unlimited) return own ?? failure('no-fit', target.closed)

  // Omat palat eivät riittäneet: sovitetaan rajattomilla ja kerrotaan puutteet.
  const relaxed = attempt(unlimitedInventory())
  if (relaxed?.track) return { ...relaxed, withinInventory: false }
  return own ?? relaxed ?? failure('no-fit', target.closed)
}

interface Assembled {
  track: Track | null
  reason: FitReason
}

function assemble(
  fit: BeamFit,
  library: PieceLibrary,
  inventory: Inventory,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  closed: boolean,
  options: FitOptions,
): Assembled {
  // Sovitus muokkaa palojen sijoituksia sulkeutuessaan, joten ketjusta otetaan
  // oma kopio — sama BeamFit voidaan arvioida uudelleen toisilla asetuksilla.
  const pieces: PlacedPiece[] = fit.pieces.map((placed) => ({ ...placed, placement: { ...placed.placement } }))
  if (pieces.length === 0) return { track: null, reason: 'no-fit' }

  const joints: [number, number][] = []
  for (let i = 1; i < pieces.length; i += 1) joints.push([i - 1, i])
  if (closed && pieces.length > 1) joints.push([pieces.length - 1, 0])

  const closure = closeChain(fit, pieces, library, closed, options)
  if (closed) {
    if (!closure.withinBudget) return { track: null, reason: 'closure-beyond-budget' }
    if (!closure.withinCaps) return { track: null, reason: 'joint-over-safety-cap' }
  }

  // Risteävä piirto on aito aikomus, mutta sen ratkaisu (X-pala tai silta) on
  // vasta myöhempää vaihetta — rikkinäistä rataa ei näytetä.
  if (countCollisions(pieces, library, joints) > 0) return { track: null, reason: 'self-collision' }

  return {
    track: summariseTrack(
      {
        pieces,
        joints,
        closure,
        usage: { ...fit.usage },
        shortages: shortagesAgainst(fit.usage, inventory),
        areaBounds: bounds,
      },
      library,
    ),
    reason: 'ok',
  }
}

/**
 * Sulkeutuminen budjettiin (README luku 5 kohta 3). Avoimella viivalla saumaa
 * ei ole, joten virhe on nolla ja raportti kertoo vain käytettävissä olevan
 * budjetin; suljetulla jäännös jaetaan liitoksille kuten generoinnissakin.
 */
function closeChain(
  fit: BeamFit,
  pieces: PlacedPiece[],
  library: PieceLibrary,
  closed: boolean,
  options: FitOptions,
): ClosureReport {
  const resolved = pieces.map((placed) => library.get(placed.pieceId))
  const joints = jointsForChain(resolved, closed)
  const gap: Vec = closed ? { x: fit.end.x - fit.start.x, y: fit.end.y - fit.start.y } : { x: 0, y: 0 }
  const angleDeg = closed ? angleDifferenceDeg(dirToDegrees(fit.end.dir), dirToDegrees(fit.start.dir)) : 0

  const report = evaluateClosure(
    joints,
    { gapMm: Math.hypot(gap.x, gap.y), angleDeg },
    { settings: options.vario, flex: options.flex, seamIndex: 0, spread: 0 },
  )
  if (closed) relaxClosure(pieces, gap, pieces.length - 1)
  return report
}
