import { oppositeDir } from '../core/dir'
import { inventoryFillTable, type FillTable } from '../core/fill'
import { Ledger, createInventory, unlimitedInventory, type Inventory } from '../core/inventory'
import { defaultLibrary, type PieceLibrary } from '../core/library'
import { samplePath } from '../core/path'
import { placedSegments, type Frame, type PlacedPiece } from '../core/pieces'
import { complementOf } from '../core/ports'
import { TRACK_WIDTH_MM } from '../core/units'
import type { Vec } from '../core/vec'
import type { FlexSettings, VarioSettings } from '../core/vario'
import { beamFit, type BeamFit, type FitTuning } from '../fit/beam'
import { cleanDrawing, polylineLength, type CleanOptions } from '../fit/simplify'
import { buildTarget } from '../fit/target'
import type { Track } from '../gen/build'
import { buildElementLibrary, bundledElementSpecs, type ElementLibrary } from '../gen/elements'
import { areaBounds, buildMask, type AreaShape } from '../gen/mask'
import { assembleTrack, countUsage } from './assemble'
import { branchAnchors, canArrive, endAnchors, BRANCH_SNAP_MM, CONTINUE_BONUS, type BranchAnchor } from './branch'
import { bridgeOver, findCrossings, levelCrossings, type CrossingSite } from './crossing'
import { relaxSection } from './replace'
import { freeEnds, type TrackChain } from './section'

// Lisäävä piirto (README luku 5 "Haara mutkaan", luku 6 "risteämiskyselyt").
// Radan vierestä alkava veto ei ole uusi rata vaan uusi haara: se etsii
// itselleen haarakohdan (branch.ts), sovittautuu siitä eteenpäin samalla
// keilahaulla kuin muukin piirto ja ratkaisee matkalla tulevan risteämän
// (crossing.ts).
//
// Epäselvyyttä ei ratkaista dialogilla: jos yksi vaihtoehto voittaa selvästi,
// se toteutetaan suoraan, ja muuten palautetaan 2–3 vaihtoehtoa
// haamuesikatseluiksi kartalle (README luku 6).

export type ExtendReason =
  | 'ok'
  | 'drawing-too-short'
  | 'not-on-track'
  | 'no-branch-point'
  | 'no-fit'
  | 'ends-beyond-budget'
  | 'joint-over-safety-cap'
  | 'self-collision'
  | 'crossing-unresolved'

export interface ExtendOptions {
  area: AreaShape
  library?: PieceLibrary
  elements?: ElementLibrary
  inventory?: Inventory
  vario?: VarioSettings
  flex?: FlexSettings
  allowConnectorFlip?: boolean
  tuning?: Partial<FitTuning>
  clean?: CleanOptions
  /** Nappausetäisyys radasta; tätä kauempaa alkava veto on uusi rata. */
  snapMm?: number
  /** Montako vaihtoehtoa palautetaan haamuesikatseluiksi. */
  maxOptions?: number
}

/**
 * Millainen haara vaihtoehdosta tuli.
 *
 * - `plain` — vapaa pää, kuten sivuraide.
 * - `rejoin` — molemmat päät radalla: vaihde myös toiseen päähän, ja haara on
 *   aito ohituskaide eikä umpiperä. Tämä on vastaus siihen, että käyttäjä
 *   piirsi viivan takaisin radalle asti.
 * - `stub` — haara pysähtyy ennen rataa, koska ylitystä ei saatu ratkaistua.
 *   Vajaa vastaus, mutta rehellinen ja parempi kuin pelkkä kieltäytyminen.
 */
export type BranchVariant = 'plain' | 'rejoin' | 'stub'

/** Yksi tapa liittää piirretty haara rataan. */
export interface BranchOption {
  track: Track
  /** Haarapalan tunnus, esim. "L". */
  junctionId: string
  /** Tuliko haara suoralle osuudelle vai kaaren tilalle? */
  kind: BranchAnchor['kind']
  variant: BranchVariant
  /** Haaran toisen pään vaihde, kun se yhdistyy takaisin rataan. */
  rejoinId: string | null
  /** Miten risteämä ratkaistiin, jos sellainen tuli vastaan. */
  crossing: 'none' | 'level' | 'bridge'
  /** Risteyspalan tai siltaelementin tunnus. */
  crossingId: string | null
  /** Uusien ja muuttuneiden palojen indeksit — haamuesikatselu piirtää nämä. */
  addedIndices: number[]
  /** Palamuutoskortti (README luku 6): "käyttää 1×L · vapauttaa 1×D". */
  added: Record<string, number>
  removed: Record<string, number>
  /** Montako palaa haaraan tuli. */
  pieceCount: number
  deviation: { meanMm: number; maxMm: number }
  withinInventory: boolean
  cost: number
}

export interface ExtendResult {
  options: BranchOption[]
  reason: ExtendReason
  /**
   * Voittiko yksi vaihtoehto niin selvästi, että sen voi toteuttaa suoraan?
   * Risteämä ei koskaan ratkea automaattisesti — se on aito kysymys.
   */
  automatic: boolean
}

/** Haaran saa piirtää lyhyeksikin: sivuraide on usein vain pätkä. */
export const MIN_BRANCH_DRAWING_MM = 120

/** Näin monta haarakohtaa sovitetaan; jokainen maksaa oman keilahakunsa. */
const MAX_ANCHORS = 6

/** Näin monta keilahaun ketjua arvioidaan per haarakohta. */
const MAX_FITS = 4

/**
 * Jos osoitetusta kohdasta ei löydy haarakohtaa, etsitään lähin mahdollinen
 * tätä kertaa kauempaa (README luku 5: "Jos mikään ei kelpaa → syy + lähin
 * mahdollinen haarakohta"). Haara ei silloin ala aivan sormen alta, mutta se on
 * parempi vastaus kuin kieltäytyminen.
 */
const FALLBACK_SNAP_FACTOR = 3

/** Näin monta haarakohtaa kokeillaan vedon toisesta päästä. */
const MAX_REJOIN_ANCHORS = 4

/**
 * Yhdistävä haara maksaa oman haarakohtahakunsa vedon kummastakin päästä, joten
 * sitä ei yritetä jokaisesta lähtökohdasta: halvimmat muutama riittävät, ja
 * kartalle mahtuu joka tapauksessa kolme haamua.
 */
const MAX_REJOIN_STARTS = 3

/**
 * Yhdistävä haara maksaa kaksi vaihdetta, mutta se on juuri se mitä radalle
 * asti piirretty viiva pyytää. Hyvitys pitää sen umpiperän edellä silloin kun
 * kumpikin kelpaa.
 */
const REJOIN_BONUS = 900

/** Kuinka kauas ennen rataa tynkähaara pysäytetään. */
const STUB_CLEARANCE_MM = TRACK_WIDTH_MM * 3

/**
 * Tynkä on **vajaa vastaus**: se toteuttaa vedosta sen osan, joka on
 * toteutettavissa, ja jättää loput tekemättä. README luku 0 asettaa keinot
 * järjestykseen — "tee se mitä pyydettiin" ja "tee se toisin" ovat kumpikin
 * tyngän edellä — joten tyngän on hävittävä jokaiselle vastaukselle, joka vie
 * viivan perille asti.
 *
 * Ilman tätä tynkä voitti risteämän, koska se on lyhyempi: sovituksen hinta
 * kasvaa palojen mukana, ja vähemmän tekevä vastaus tuli siten halvemmaksi.
 * Sakko on silti paljon irrallista rataa pienempi, koska tynkä on kiinni
 * radassa.
 */
const STUB_COST = 5000

/**
 * Irrallinen rata on viimeinen keino, joten sen on hävittävä kaikelle muulle.
 * Se ei silti ole kielto vaan vastaus: käyttäjä näkee mihin hänen viivastaan
 * tuli rataa, ja saa sen kiinni piirtämällä sen päästä (README luku 0).
 */
const LOOSE_COST = 100000

/** Irrallinen rata alkaa vasta täältä: kaksi lautaa ei mahdu samaan kohtaan. */
const LOOSE_CLEARANCE_MM = TRACK_WIDTH_MM * 1.5

/**
 * Haarakohdan hinta on **tasapelin ratkaisija, ei tuomari.** Se kertoo mistä
 * haara lähtee — kuinka läheltä sormea ja kuinka tavallisella palalla — mutta
 * sen mitä käyttäjä piirsi mittaa sovitus. Täydellä painolla ne olivat samaa
 * suuruusluokkaa, ja haarakohta kumosi sovituksen tuomion: kohtisuoraan
 * vedetylle viivalle `T` sovittui mitatusti parhaiten (227 vastaan 262 ja 291),
 * mutta hävisi, koska `L` on `basic` ja `O1` lyhyempi — kumpikaan ei kerro
 * mitään piirretystä muodosta.
 */
const ANCHOR_WEIGHT = 0.25

/** Voittaja on selvä, jos se on tämän verran halvempi kuin seuraava. */
const AUTO_MARGIN = 0.7

/** Risteämän ratkaisun hinta: tasoristeys on kevyempi kuin silta. */
const LEVEL_CROSSING_COST = 400
const BRIDGE_COST = 700

/** Lyhyempi jakso risteämän jälkeen on mittausvirhe, ei aikomus. */
const MIN_LEG_MM = 60

/** Kiinnitetystä päätyportista saa jäädä näin kauas; loput nielee Vario. */
const GOAL_TOLERANCE_MM = 40

/** Haaran keila pidetään kapeana: se on lyhyt eikä sen tarvitse etsiä saumaa. */
const BRANCH_TUNING: Partial<FitTuning> = { beamWidth: 12, resultLimit: 8 }

let cachedElements: ElementLibrary | null = null

function defaultElements(library: PieceLibrary): ElementLibrary {
  cachedElements ??= buildElementLibrary(bundledElementSpecs(), library, new Ledger(unlimitedInventory()))
  return cachedElements
}

function failure(reason: ExtendReason): ExtendResult {
  return { options: [], reason, automatic: false }
}

interface Context {
  track: Track
  library: PieceLibrary
  elements: ElementLibrary
  inventory: Inventory
  table: FillTable
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  options: ExtendOptions
}

/**
 * Sovittaa piirretyn viivan uudeksi haaraksi valmiiseen rataan. Alkuperäinen
 * rata jää koskemattomaksi: epäonnistunut yritys palauttaa vain syyn
 * (CLAUDE.md — rata on joka välivaiheessa ehjä).
 */
export function extendTrack(track: Track, rawPoints: readonly Vec[], options: ExtendOptions): ExtendResult {
  const library = options.library ?? defaultLibrary()
  const inventory = options.inventory ?? unlimitedInventory()
  const snapMm = options.snapMm ?? BRANCH_SNAP_MM

  const drawing = cleanDrawing(rawPoints, options.clean)
  if (!drawing || drawing.lengthMm < MIN_BRANCH_DRAWING_MM) return failure('drawing-too-short')

  // Vedon saa aloittaa kummasta päästä tahansa: radan lähempi pää on haaran
  // juuri, toinen sen vapaa pää.
  const points = orientFromTrack(drawing.points, track, library, snapMm)
  if (!points) return failure('not-on-track')

  const table = inventoryFillTable(library, inventory)
  const context: Context = {
    track,
    library,
    elements: options.elements ?? defaultElements(library),
    inventory,
    table,
    bounds: areaBounds(buildMask(options.area)),
    options,
  }

  // Radan koloportti jatkuu toisin päin kuin tappiportti, joten se ei kulje
  // haarakohtien kanssa samaa reittiä — ja se on olemassa myös silloin kun
  // yhtään haarakohtaa ei löydy.
  const built: BranchOption[] = backwardOptions(context, points, snapMm)

  // Osoitettuun kohtaan ei aina mahdu vaihdetta. Silloin etsitään lähin
  // mahdollinen haarakohta kauempaa sen sijaan että kieltäydyttäisiin.
  const anchors =
    findAnchors(track, library, table, inventory, points[0], snapMm) ||
    findAnchors(track, library, table, inventory, points[0], snapMm * FALLBACK_SNAP_FACTOR)
  if (!anchors) {
    if (built.length === 0) built.push(...looseOptions(context, points))
    if (built.length === 0) return failure('no-branch-point')
    return { options: rank(built, options.maxOptions ?? 3), reason: 'ok', automatic: true }
  }

  let firstReason: ExtendReason | null = null

  // Päättyykö veto radalle? Silloin käyttäjä ei piirtänyt umpiperää vaan
  // yhdistävän haaran, ja vastaukseen kuuluu vaihde myös toiseen päähän.
  const rejoins = distanceToTrack(points[points.length - 1], track, library) <= snapMm

  for (const [index, anchor] of anchors.entries()) {
    const before = built.length
    if (rejoins && index < MAX_REJOIN_STARTS) built.push(...rejoinOptions(context, anchor, points, snapMm))

    const fits = fitLeg(context, anchor.pieces, anchor.frame, points, null)
    if (fits.length === 0) {
      firstReason ??= 'no-fit'
      continue
    }

    const attempts = fits.slice(0, MAX_FITS)
    for (const fit of attempts) {
      const assembled = attach(context, anchor, [{ pieces: fit.pieces, from: anchor.junctionIndex }], {
        crossing: 'none',
        crossingId: null,
        deviation: fit.deviation,
        extraCost: fit.cost,
      })
      if (assembled.option) {
        built.push(assembled.option)
        break
      }
      firstReason ??= assembled.reason
    }

    // Ketju leikkaa vanhan radan: se on aito aikomus, ja siihen on kaksi
    // vastausta (README luku 6). Kumpaakin tarjotaan omana vaihtoehtonaan —
    // myös silloin kun rataa ennen pysähtyvä ketju jo kelpasi, koska
    // lyhentäminen ei ole vastaus kysymykseen "yli vai poikki".
    const crossing = firstCrossing(context, anchor, attempts)
    if (!crossing) {
      if (built.length === before) firstReason ??= 'no-fit'
      continue
    }

    // Vain yksi risteämä kerrallaan ratkaistaan: useampi ylitys yhdellä vedolla
    // on kysymys, johon ei ole yhtä vastausta.
    if (crossing.sites.length === 1) {
      built.push(
        ...levelOptions(context, anchor, points, crossing.sites[0]),
        ...bridgeOptions(context, anchor, crossing.fit, crossing.sites[0]),
      )
    }

    if (built.length > before) continue

    // Kumpikaan vastaus ei mahdu. Tarjotaan edes haara, joka pysähtyy ennen
    // rataa: vajaa vastaus on parempi kuin kieltäytyminen, ja käyttäjä näkee
    // heti mihin asti hänen viivastaan tuli rataa.
    const stub = stubOption(context, anchor, points, crossing.sites[0])
    if (stub) built.push(stub)
    else firstReason = 'crossing-unresolved'
  }

  // Mikään ei kiinnittynyt. Piirretty on silti toteutettava jotenkin, joten
  // palat menevät lattialle viivan alle irrallisena ratana (README luku 0).
  if (built.length === 0) built.push(...looseOptions(context, points))
  if (built.length === 0) return failure(firstReason ?? 'no-fit')

  const ranked = rank(built, options.maxOptions ?? 3)
  // Risteämä on aito kysymys eikä ratkea itsestään, joten sen sisältävä
  // vaihtoehtojoukko menee aina käyttäjälle asti.
  const automatic =
    ranked.every((option) => option.crossing === 'none') &&
    (ranked.length === 1 || ranked[0].cost <= ranked[1].cost * AUTO_MARGIN)
  return { options: ranked, reason: 'ok', automatic }
}

// --- Sovitus ----------------------------------------------------------------

/**
 * Sovittaa yhden jakson piirretystä viivasta annetusta kehyksestä eteenpäin.
 * Käytettävissä oleva kokoelma on käyttäjän palat miinus se, mikä on jo
 * kiinni radalla — sama sääntö kuin osion korvauksessa.
 */
function fitLeg(
  context: Context,
  base: readonly PlacedPiece[],
  /** Kiinnitetty aloituskehys, tai null kun vain maali on kiinnitetty. */
  start: Frame | null,
  points: readonly Vec[],
  goal: Frame | null,
): BeamFit[] {
  if (points.length < 2 || polylineLength(points) < MIN_LEG_MM) return []
  const anchored = start ? [{ x: start.x, y: start.y }, ...points.slice(1)] : [...points]
  if (goal) anchored[anchored.length - 1] = { x: goal.x, y: goal.y }

  return beamFit(buildTarget({ points: anchored, closed: false, lengthMm: polylineLength(anchored) }), {
    library: context.library,
    inventory: minus(context.inventory, countUsage(base)),
    tuning: { ...BRANCH_TUNING, ...context.options.tuning },
    allowConnectorFlip: context.options.allowConnectorFlip,
    start: start ? [start] : undefined,
    goal: goal ? { frame: goal, toleranceMm: GOAL_TOLERANCE_MM } : undefined,
  })
}

interface Leg {
  pieces: PlacedPiece[]
  /**
   * Mihin pohjaradan palaan jakson ensimmäinen pala liittyy. Puuttuu, kun jakso
   * kiinnittyy vain lopustaan — radan koloportista taaksepäin jatkettaessa
   * ketju rakennetaan lattialta kiskonpäätä kohti.
   */
  from?: number
  /** Mihin pohjaradan palaan jakson viimeinen pala liittyy (risteyksen kohdalla). */
  to?: number
}

interface Attached {
  option: BranchOption | null
  reason: ExtendReason
}

/**
 * Kokoaa pohjaradan ja haarajaksot yhdeksi radaksi ja tarkistaa, ettei se riko
 * mitään: päätyheiton on mahduttava budjettiin, liitosten turvakaton alle, eikä
 * uusia törmäyksiä saa syntyä.
 */
function attach(
  context: Context,
  anchor: BranchAnchor,
  legs: Leg[],
  meta: {
    crossing: BranchOption['crossing']
    crossingId: string | null
    deviation: { meanMm: number; maxMm: number }
    extraCost: number
    base?: TrackChain
    gapMm?: number
    localJoints?: readonly [number, number][]
    variant?: BranchVariant
    rejoinId?: string | null
    /**
     * Kuuluvatko haaran omat liitokset päätyheiton kantajiin? Vapaapäisellä
     * haaralla heittoa ei ole, mutta molemmista päistään kiinni olevalla on —
     * ja se on syntynyt juuri näissä liitoksissa.
     */
    localiseLegs?: boolean
  },
): Attached {
  const { library, options } = context
  const base = meta.base ?? { pieces: anchor.pieces, joints: anchor.joints }
  const gapMm = meta.gapMm ?? anchor.gapMm
  const localJoints = meta.localJoints ?? anchor.localJoints

  const pieces: PlacedPiece[] = base.pieces.map((placed) => ({ ...placed, placement: { ...placed.placement } }))
  const joints: [number, number][] = base.joints.map(([a, b]) => [a, b])
  const legJoints: [number, number][] = []
  let branchCount = 0

  for (const leg of legs) {
    if (leg.pieces.length === 0) continue
    const first = pieces.length
    pieces.push(...leg.pieces.map((placed) => ({ ...placed, placement: { ...placed.placement } })))
    branchCount += leg.pieces.length
    for (let i = first + 1; i < pieces.length; i += 1) legJoints.push([i - 1, i])
    if (leg.from !== undefined) legJoints.push([leg.from, first])
    if (leg.to !== undefined) legJoints.push([pieces.length - 1, leg.to])
  }
  if (branchCount === 0) return { option: null, reason: 'no-fit' }
  joints.push(...legJoints)

  // Haarakohdan päätyheitto kuuluu sen omalle osuudelle: se on syntynyt siinä
  // ja sen on mahduttava siihen (sama malli kuin osion korvauksessa).
  const assembled = assembleTrack(
    context.track,
    { pieces, joints, localJoints: meta.localiseLegs ? [...localJoints, ...legJoints] : localJoints, gapMm },
    { library, inventory: context.inventory, vario: options.vario, flex: options.flex, bounds: context.bounds },
  )
  const next = assembled.track
  if (!next) return { option: null, reason: assembled.reason }

  const removed = { ...anchor.removed }
  const added = { ...anchor.added }
  for (const leg of legs) for (const placed of leg.pieces) added[placed.pieceId] = (added[placed.pieceId] ?? 0) + 1

  return {
    option: {
      track: next,
      junctionId: anchor.junctionId,
      kind: anchor.kind,
      variant: meta.variant ?? 'plain',
      rejoinId: meta.rejoinId ?? null,
      crossing: meta.crossing,
      crossingId: meta.crossingId,
      addedIndices: newPieceIndices(context.track, next),
      added,
      removed,
      pieceCount: branchCount,
      deviation: meta.deviation,
      withinInventory: Object.keys(next.shortages).length === 0,
      cost: anchor.cost * ANCHOR_WEIGHT + meta.extraCost,
    },
    reason: 'ok',
  }
}

// --- Haarakohdan haku --------------------------------------------------------

/**
 * Haarakohdat annetulla nappausetäisyydellä, tai null jos niitä ei ole yhtään.
 * Radan avoimet päät tulevat mukaan ensimmäisinä: kiskonpään vieressä veto on
 * lähes aina jatko eikä uusi haara sen viereen.
 */
function findAnchors(
  track: TrackChain,
  library: PieceLibrary,
  table: FillTable,
  inventory: Inventory,
  point: Vec,
  snapMm: number,
): BranchAnchor[] | null {
  const anchors = [
    ...endAnchors(track, library, point, snapMm),
    ...branchAnchors(track, library, table, inventory, point, { snapMm, limit: MAX_ANCHORS }),
  ]
  return anchors.length > 0 ? anchors.slice(0, MAX_ANCHORS) : null
}

/**
 * Jatko radan **koloportista**. Ketju kulkee aina kolosta tappiin, joten
 * koloporttiin päättyvää rataa ei voi jatkaa eteenpäin samalla tavalla kuin
 * tappiporttia: ketju on rakennettava lattialta kiskonpäätä kohti ja
 * kiinnitettävä vasta lopustaan.
 *
 * Piirretyllä radalla on aina tasan yksi kumpaakin päätä, joten ilman tätä
 * puolet radan päistä ei jatkuisi lainkaan — ja juuri ne päät olisivat niitä,
 * joiden viereen koodi työntäisi vaihteen.
 */
function backwardOptions(context: Context, points: readonly Vec[], snapMm: number): BranchOption[] {
  const { track, library } = context
  const results: BranchOption[] = []
  // Veto on jo käännetty niin, että sen alku on radalla; taaksepäin
  // rakennettava ketju kulkee toisin päin.
  const reversed = [...points].reverse()

  for (const end of freeEnds(track, library)) {
    if (!canArrive(library, end.frame)) continue
    if (Math.hypot(end.frame.x - points[0].x, end.frame.y - points[0].y) > snapMm) continue

    const goal = arrivalAt(end.frame)
    for (const fit of fitLeg(context, track.pieces, null, reversed, goal).slice(0, MAX_FITS)) {
      const gap: Vec = { x: fit.end.x - goal.x, y: fit.end.y - goal.y }
      const legPieces = fit.pieces.map((placed) => ({ ...placed, placement: { ...placed.placement } }))
      relaxSection(legPieces, gap)

      const attached = attach(context, endAnchorFor(track, end.index, end.portId, end.frame), [
        { pieces: legPieces, to: end.index },
      ], {
        crossing: 'none',
        crossingId: null,
        deviation: fit.deviation,
        extraCost: fit.cost,
        gapMm: Math.hypot(gap.x, gap.y),
        localiseLegs: true,
      })
      if (attached.option) {
        results.push(attached.option)
        break
      }
    }
  }
  return results
}

/**
 * Viimeinen keino: palat piirretyn viivan alle **ilman liitosta**. Käyttäjä
 * piirsi jotain johonkin, joten jotain on tehtävä (README luku 0) — ja
 * irrallinen rata on lattialla arkipäivää. Sen saa kiinni piirtämällä sen
 * päästä, tai poistettua valitsemalla.
 *
 * Tämä ei silti saa mennä päällekkäin muun radan kanssa: kaksi lautaa samassa
 * kohdassa ei ole vastaus vaan sotku, ja `attach` hylkää törmäykset.
 */
function looseOptions(context: Context, points: readonly Vec[]): BranchOption[] {
  const { track, library } = context

  // Veto alkaa radan vierestä — siitähän se tulkittiin haaraksi — joten sen
  // alku on radan päällä. Irrallinen rata aloitetaan vasta siitä mistä lattia
  // on vapaa, muuten kaksi lautaa osuisi samaan kohtaan.
  const clear = trimNearTrack(points, track, library)
  if (!clear) return []

  for (const fit of fitLeg(context, track.pieces, null, clear, null).slice(0, MAX_FITS)) {
    const attached = attach(context, looseAnchor(track), [{ pieces: fit.pieces }], {
      crossing: 'none',
      crossingId: null,
      deviation: fit.deviation,
      extraCost: fit.cost + LOOSE_COST,
    })
    if (attached.option) return [attached.option]
  }
  return []
}

/**
 * Viiva siitä kohdasta alkaen, jossa se irtoaa radasta. Siivottu veto on vain
 * muutama piste, joten pisteiden suodattaminen veisi koko viivan — murtoviiva
 * on katkaistava ja katkaisukohta laskettava.
 */
function trimNearTrack(points: readonly Vec[], track: Track, library: PieceLibrary): Vec[] | null {
  const STEP_MM = 15
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]
    const to = points[i]
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STEP_MM))
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      const at: Vec = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
      if (distanceToTrack(at, track, library) <= LOOSE_CLEARANCE_MM) continue
      const rest = [at, ...points.slice(i)]
      return polylineLength(rest) >= MIN_LEG_MM ? rest : null
    }
  }
  return null
}

/** Pseudohaarakohta tyhjään: ei palaa, ei porttia, ei liitosta. */
function looseAnchor(track: Track): BranchAnchor {
  return {
    kind: 'loose',
    junctionId: '',
    portId: '',
    frame: { x: 0, y: 0, dir: 0, level: 0, open: 'pin' },
    pieces: [...track.pieces],
    joints: track.joints.map(([a, b]) => [a, b] as [number, number]),
    junctionIndex: 0,
    gapMm: 0,
    localJoints: [],
    added: {},
    removed: {},
    offsetMm: 0,
    cost: 0,
  }
}

/** Pseudohaarakohta radan päähän: jatko ei lisää vaihdetta eikä muuta rataa. */
function endAnchorFor(track: Track, index: number, portId: string, frame: Frame): BranchAnchor {
  return {
    kind: 'end',
    junctionId: track.pieces[index].pieceId,
    portId,
    frame,
    pieces: [...track.pieces],
    joints: track.joints.map(([a, b]) => [a, b] as [number, number]),
    junctionIndex: index,
    gapMm: 0,
    localJoints: [],
    added: {},
    removed: {},
    offsetMm: 0,
    cost: -CONTINUE_BONUS,
  }
}

// --- Yhdistävä haara ---------------------------------------------------------

/**
 * Haara, joka päättyy takaisin radalle. Toinen pää tarvitsee oman vaihteensa,
 * ja ketju sovitetaan sen porttiin kiinnitettynä maalina — samalla tavalla kuin
 * osion korvauksessa. Ilman tätä radalle asti piirretty viiva jättäisi kiskon
 * pään lattialle kiinni toiseen rataan ilman liitosta, mikä näyttää kartalla
 * yhtenäiseltä muttei ole sitä.
 */
function rejoinOptions(context: Context, anchor: BranchAnchor, points: readonly Vec[], snapMm: number): BranchOption[] {
  const { library, table, inventory } = context
  const base: TrackChain = { pieces: anchor.pieces, joints: anchor.joints }
  const endPoint = points[points.length - 1]
  const results: BranchOption[] = []

  const ends = branchAnchors(base, library, table, inventory, endPoint, {
    snapMm,
    limit: MAX_REJOIN_ANCHORS,
    arrival: true,
  })

  for (const end of ends) {
    // Toisen vaihteen upotus järjesti palataulukon uusiksi; ensimmäinen vaihde
    // etsitään sijainnistaan, ei indeksistään (sama syy kuin risteyksessä).
    const junctionIndex = indexOfPlacement(end.pieces, anchor.pieces[anchor.junctionIndex])
    if (junctionIndex === null) continue

    const goal = arrivalAt(end.frame)
    const fits = fitLeg(context, end.pieces, anchor.frame, points, goal)
    if (fits.length === 0) continue

    for (const fit of fits.slice(0, MAX_FITS)) {
      // Ketjun pää jää maalista muutaman millin päähän; heitto jaetaan haaran
      // omille liitoksille, jottei kumpikaan vaihde liiku.
      const gap: Vec = { x: fit.end.x - goal.x, y: fit.end.y - goal.y }
      const legPieces = fit.pieces.map((placed) => ({ ...placed, placement: { ...placed.placement } }))
      relaxSection(legPieces, gap)

      const attached = attach(context, anchor, [{ pieces: legPieces, from: junctionIndex, to: end.junctionIndex }], {
        crossing: 'none',
        crossingId: null,
        variant: 'rejoin',
        rejoinId: end.junctionId,
        deviation: fit.deviation,
        extraCost: fit.cost + end.cost - REJOIN_BONUS,
        base: { pieces: end.pieces, joints: end.joints },
        gapMm: anchor.gapMm + end.gapMm + Math.hypot(gap.x, gap.y),
        localJoints: [...anchor.localJoints, ...end.localJoints],
        localiseLegs: true,
      })
      if (!attached.option) continue
      results.push({
        ...attached.option,
        added: mergeCounts(attached.option.added, end.added),
        removed: mergeCounts(attached.option.removed, end.removed),
      })
      break
    }
  }
  return results
}

/** Kehys, johon portin kautta saavutaan: ketjun on päätyttävä tähän. */
function arrivalAt(frame: Frame): Frame {
  return { ...frame, dir: oppositeDir(frame.dir), open: complementOf(frame.open) }
}

// --- Risteämän ratkaisu ------------------------------------------------------

/**
 * Ketju, joka ylittää vanhan radan, ja sen ylitykset.
 *
 * Sovitus palauttaa monta lähes samanarvoista ketjua, ja ne ylittävät radan
 * hieman eri kohdista — yksi menee siististi poikki, toinen sipaisee matkalla
 * mutkaa. "Useampi ylitys yhdellä vedolla jätetään ratkaisematta" on sääntö
 * sille mitä *käyttäjä piirsi*, ei sille kumman ketjun keila sattui
 * palauttamaan ensimmäisenä. Siksi ratkaistavaksi otetaan **se ketju, jonka
 * ylityskuva on selvin**: yksi ylitys voittaa kaksi.
 *
 * Ilman tätä yksi sipaisu vei koko risteämävastauksen, ja käyttäjä sai tilalle
 * radan viereen pysähtyvän haaran.
 */
function firstCrossing(
  context: Context,
  anchor: BranchAnchor,
  fits: readonly BeamFit[],
): { fit: BeamFit; sites: CrossingSite[] } | null {
  let fallback: { fit: BeamFit; sites: CrossingSite[] } | null = null

  for (const fit of fits) {
    const sites = findCrossings(anchor.pieces, fit.pieces, context.library, [[anchor.junctionIndex, 0]])
    if (sites.length === 0) continue
    if (sites.length === 1) return { fit, sites }
    fallback ??= { fit, sites }
  }
  return fallback
}

/**
 * Haara, joka pysähtyy ennen rataa. Tämä on viimeinen vastaus siihen, että
 * ylitykselle ei löydy risteystä eikä siltaa: viivasta toteutetaan se osa, joka
 * on toteutettavissa, ja käyttäjä näkee kartalta mihin asti.
 */
function stubOption(context: Context, anchor: BranchAnchor, points: readonly Vec[], site: CrossingSite): BranchOption | null {
  const head = trimBefore(points, site.point, STUB_CLEARANCE_MM)
  if (!head) return null

  for (const fit of fitLeg(context, anchor.pieces, anchor.frame, head, null).slice(0, MAX_FITS)) {
    const attached = attach(context, anchor, [{ pieces: fit.pieces, from: anchor.junctionIndex }], {
      crossing: 'none',
      crossingId: null,
      variant: 'stub',
      deviation: fit.deviation,
      extraCost: fit.cost + STUB_COST,
    })
    if (attached.option) return attached.option
  }
  return null
}

/** Viiva katkaistuna annetun pisteen kohdalta, ja vielä `backMm` sitä ennen. */
function trimBefore(points: readonly Vec[], at: Vec, backMm: number): Vec[] | null {
  const head = splitAt(points, at).head
  let remaining = backMm
  const trimmed = [...head]
  while (trimmed.length > 1 && remaining > 0) {
    const last = trimmed[trimmed.length - 1]
    const previous = trimmed[trimmed.length - 2]
    const step = Math.hypot(last.x - previous.x, last.y - previous.y)
    if (step > remaining) {
      const t = (step - remaining) / step
      trimmed[trimmed.length - 1] = { x: previous.x + (last.x - previous.x) * t, y: previous.y + (last.y - previous.y) * t }
      return trimmed
    }
    trimmed.pop()
    remaining -= step
  }
  return trimmed.length > 1 ? trimmed : null
}

/** Silta: uusi ketju nostetaan vanhan radan yli mäkielementillä. */
function bridgeOptions(context: Context, anchor: BranchAnchor, fit: BeamFit, site: CrossingSite): BranchOption[] {
  const bridged = bridgeOver(
    fit.pieces,
    context.library,
    context.elements,
    context.table,
    minus(context.inventory, countUsage(anchor.pieces)),
    site,
  )
  if (!bridged) return []

  const attached = attach(context, anchor, [{ pieces: bridged.pieces, from: anchor.junctionIndex }], {
    crossing: 'bridge',
    crossingId: bridged.elementId,
    deviation: fit.deviation,
    extraCost: fit.cost + BRIDGE_COST,
    gapMm: anchor.gapMm + bridged.gapMm,
  })
  return attached.option ? [attached.option] : []
}

/**
 * Tasoristeys: risteyspala upotetaan vanhalle radalle ja uusi ketju sovitetaan
 * sen läpi kahtena jaksona. Ensimmäinen jakso päättyy risteyksen porttiin
 * täsmälleen, toinen jatkaa vapaana viivan loppuun.
 */
function levelOptions(context: Context, anchor: BranchAnchor, points: readonly Vec[], site: CrossingSite): BranchOption[] {
  const base: TrackChain = { pieces: anchor.pieces, joints: anchor.joints }
  const results: BranchOption[] = []

  // Haara kulkee koko matkan samalla liitinparillisuudella, joten risteyksen
  // on otettava se vastaan — muuten pala ei mene kiinni.
  for (const crossing of levelCrossings(base, context.library, context.table, context.inventory, site, anchor.frame.open)) {
    // Risteyspalan upotus siirsi pohjaradan indeksejä; haarapala löytyy siitä
    // mihin `splice` sen jätti, joten se etsitään sijainnin perusteella.
    const junctionIndex = indexOfPlacement(crossing.pieces, anchor.pieces[anchor.junctionIndex])
    if (junctionIndex === null) continue

    const split = splitAt(points, crossing.inFrame)
    const head = fitLeg(context, crossing.pieces, anchor.frame, split.head, crossing.inFrame)
    if (head.length === 0) continue

    const legs: Leg[] = [{ pieces: head[0].pieces, from: junctionIndex, to: crossing.crossingIndex }]
    let deviation = head[0].deviation
    let cost = head[0].cost

    const tail = fitLeg(context, [...crossing.pieces, ...head[0].pieces], crossing.outFrame, split.tail, null)
    if (tail.length > 0) {
      legs.push({ pieces: tail[0].pieces, from: crossing.crossingIndex })
      deviation = {
        meanMm: (deviation.meanMm + tail[0].deviation.meanMm) / 2,
        maxMm: Math.max(deviation.maxMm, tail[0].deviation.maxMm),
      }
      cost += tail[0].cost
    }

    const attached = attach(context, anchor, legs, {
      crossing: 'level',
      crossingId: crossing.crossingId,
      deviation,
      extraCost: cost + LEVEL_CROSSING_COST,
      base: { pieces: crossing.pieces, joints: crossing.joints },
      gapMm: anchor.gapMm + crossing.gapMm,
      localJoints: crossing.localJoints,
    })
    if (attached.option) {
      results.push({
        ...attached.option,
        added: mergeCounts(attached.option.added, crossing.added),
        removed: mergeCounts(attached.option.removed, crossing.removed),
      })
    }
  }
  return results
}

/** Katkaisee piirretyn viivan kohdasta, jossa se ylittää radan. */
function splitAt(points: readonly Vec[], at: Vec): { head: Vec[]; tail: Vec[] } {
  let bestIndex = 1
  let bestT = 0
  let best = Infinity

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1]
    const to = points[i]
    const dx = to.x - from.x
    const dy = to.y - from.y
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - from.x) * dx + (at.y - from.y) * dy) / lengthSq))
    const distance = Math.hypot(at.x - (from.x + dx * t), at.y - (from.y + dy * t))
    if (distance < best) {
      best = distance
      bestIndex = i
      bestT = t
    }
  }

  const from = points[bestIndex - 1]
  const to = points[bestIndex]
  const cut: Vec = { x: from.x + (to.x - from.x) * bestT, y: from.y + (to.y - from.y) * bestT }
  return { head: [...points.slice(0, bestIndex), cut], tail: [cut, ...points.slice(bestIndex)] }
}

// --- Apurit ------------------------------------------------------------------

/**
 * Kääntää vedon niin, että sen alku on radalla. Jos kumpikaan pää ei ole
 * nappausetäisyydellä, veto ei ole haara vaan uusi rata.
 */
function orientFromTrack(points: readonly Vec[], track: Track, library: PieceLibrary, snapMm: number): Vec[] | null {
  const head = distanceToTrack(points[0], track, library)
  const tail = distanceToTrack(points[points.length - 1], track, library)
  if (Math.min(head, tail) > snapMm) return null
  return tail < head ? [...points].reverse() : [...points]
}

/** Kuinka lähellä rataa piste on. Sivun 3 logiikka päättää tästä, onko veto haara vai uusi rata. */
export function distanceToTrack(point: Vec, track: TrackChain, library: PieceLibrary): number {
  let best = Infinity
  for (const placed of track.pieces) {
    const piece = library.get(placed.pieceId)
    for (const sample of samplePath(placedSegments(placed, piece), 20)) {
      const distance = Math.hypot(sample.x - point.x, sample.y - point.y)
      if (distance < best) best = distance
    }
  }
  return best
}

/** Kokoelma, josta jo käytetty on vähennetty. */
function minus(inventory: Inventory, usage: Record<string, number>): Inventory {
  if (inventory.unlimited) return inventory
  const counts: Record<string, number> = {}
  for (const [id, count] of Object.entries(inventory.counts)) counts[id] = Math.max(0, count - (usage[id] ?? 0))
  return createInventory(counts)
}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const merged = { ...a }
  for (const [id, count] of Object.entries(b)) merged[id] = (merged[id] ?? 0) + count
  return merged
}

function placementKey(placed: PlacedPiece): string {
  const { x, y, rot, mirror, level } = placed.placement
  return `${placed.pieceId}|${x.toFixed(1)}|${y.toFixed(1)}|${rot}|${mirror}|${level}`
}

/**
 * Mitkä palat ovat uusia tai siirtyneitä. Vertailu tehdään sijoituksista eikä
 * indekseistä, koska osuuden uudelleentäyttö järjestää taulukon uusiksi —
 * koskematon pala on täsmälleen siellä missä ennenkin.
 */
export function newPieceIndices(before: TrackChain, after: TrackChain): number[] {
  const remaining = new Map<string, number>()
  for (const placed of before.pieces) {
    const key = placementKey(placed)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }

  const indices: number[] = []
  after.pieces.forEach((placed, index) => {
    const key = placementKey(placed)
    const count = remaining.get(key) ?? 0
    if (count > 0) remaining.set(key, count - 1)
    else indices.push(index)
  })
  return indices
}

/** Saman sijoituksen indeksi toisessa palalistassa. */
function indexOfPlacement(pieces: readonly PlacedPiece[], target: PlacedPiece): number | null {
  const key = placementKey(target)
  const index = pieces.findIndex((placed) => placementKey(placed) === key)
  return index >= 0 ? index : null
}

/**
 * Paras ensin, ja vain yksi vaihtoehto per haarapalan ja risteämäratkaisun
 * yhdistelmä: kaksi lähes samanlaista haamua kartalla ei ole valinta vaan sotku.
 */
function rank(options: readonly BranchOption[], limit: number): BranchOption[] {
  const seen = new Set<string>()
  return [...options]
    .sort((a, b) => a.cost - b.cost || a.junctionId.localeCompare(b.junctionId))
    .filter((option) => {
      // Risteämässä kysymys on "yli vai poikki", ei se mikä vaihde haaran
      // aloittaa: kolme tasoristeystä eri vaihteilla on yksi vastaus kolmesti,
      // ja se työntäisi sillan — toisen aidon vastauksen — kokonaan pois.
      //
      // Sama koskee tynkää: "haara pysähtyy ennen rataa" on yksi vastaus, ja
      // se mistä vaihteesta se lähtee ei tee siitä toista. Kaksi tynkää
      // kartalla veisi tilan aidoilta vastauksilta.
      const key =
        option.variant === 'stub'
          ? 'stub'
          : option.crossing === 'none'
            ? `${option.junctionId}|${option.kind}|${option.variant}|${option.rejoinId ?? ''}|none`
            : `${option.crossing}|${option.crossingId ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}
