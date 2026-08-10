import { t } from '../../i18n'
import { formatCm, formatMetres, formatNumber, formatPercent } from '../../i18n/format'
import { pieceName } from '../../i18n/pieces'
import type { PieceLibrary } from '../../core/library'
import type { ExtendReason } from '../../edit'
import type { Track } from '../../gen/build'
import type { GenerateResult } from '../../gen/generate'
import type { AreaShape } from '../../gen/mask'
import { ActionBar } from '../components'
import { describeFailure } from '../failure'
import {
  describeExtendFailure,
  describeFitFailure,
  describeSectionNote,
  type DrawingState,
  type EditChoice,
  type EditState,
  type RemovalState,
  type SectionState,
} from '../drawing'
import type { Ghost, HandleId, Point } from '../state'
import { TrackMap } from '../TrackMap'

interface GeneratePageProps {
  area: AreaShape
  library: PieceLibrary
  result: GenerateResult | null
  busy: boolean
  /** Tyhjä pöytä: generoitua rataa ei näytetä, ja piirto alkaa puhtaalta. */
  blank: boolean
  seedLabel: string
  /** Piirtotila päällä: yksi sormi piirtää, kaksi navigoi. */
  drawMode: boolean
  /** Viimeisin vapaalla kädellä piirretty rata, tai null. */
  drawing: DrawingState | null
  /** Viimeisin raakaveto haaleana radan alle. */
  guide: Point[] | null
  /** Käsin muokattu rata, joka syrjäyttää generoidun ja piirretyn. */
  edited: EditState | null
  /** Valittu osio ja sen tehtävänanto, tai null. */
  section: SectionState | null
  /** Poistettu osio odottamassa ratkaisuaan, tai null. */
  removal: RemovalState | null
  /** Ratkaisematta oleva kysymys, tai null. */
  choice: EditChoice | null
  /** Kysymyksen vaihtoehdot haamuina kartalla. */
  ghosts: Ghost[] | null
  /** Miksi haaraa ei saatu rataan, tai null. */
  extendFailure: ExtendReason | null
  onDrawModeChange: (drawing: boolean) => void
  onDraw: (points: Point[]) => void
  onTapPiece: (index: number | null) => void
  onTapGhost: (index: number) => void
  onCancelChoice: () => void
  onSolve: () => void
  onRemove: () => void
  onFillGap: () => void
  onUndoRemove: () => void
  onHandleMove: (handle: HandleId, point: Point) => void
  onSeedChange: (seed: string) => void
  onClear: () => void
  onRegenerate: () => void
  onShowResult: () => void
}

/**
 * Sivu 3: generointi, piirto ja muokkaus samassa näkymässä (R2). Kartta on
 * sankari, ja epäselvyydet kerrotaan kartan alla olevalla statusrivillä — ei
 * dialogeina. Toimintorivi vaihtuu sen mukaan onko osio valittuna, onko aukko
 * auki vai odottaako kysymys vastausta.
 */
export function GeneratePage({
  area,
  library,
  result,
  busy,
  blank,
  seedLabel,
  drawMode,
  drawing,
  guide,
  edited,
  section,
  removal,
  choice,
  ghosts,
  extendFailure,
  onDrawModeChange,
  onDraw,
  onTapPiece,
  onTapGhost,
  onCancelChoice,
  onSolve,
  onRemove,
  onFillGap,
  onUndoRemove,
  onHandleMove,
  onSeedChange,
  onClear,
  onRegenerate,
  onShowResult,
}: GeneratePageProps) {
  const winner = result?.winner ?? null
  const track = edited?.track ?? drawing?.result.track ?? winner?.track ?? null

  return (
    <div class="page map-page">
      <TrackMap
        area={area}
        // Poistettu osio näkyy kartalla aukkona, mutta muokattava rata on yhä
        // alkuperäinen: aukko on kysymys, ei tila johon rata jää.
        track={removal?.preview ?? track}
        library={library}
        mode={drawMode ? 'draw' : 'view'}
        guide={guide}
        selection={removal ? null : section?.section.indices ?? null}
        // Kahvat pois heti kun kartalla on kysymys: niiden osuma-alue on
        // sormen kokoinen ja se peittäisi juuri ne haamut, joita napautetaan.
        handles={removal || choice ? null : section?.handles ?? null}
        ghosts={ghosts}
        gap={removal?.gap ?? null}
        badge={badgeFor(section, removal, track)}
        onDraw={onDraw}
        onTapPiece={onTapPiece}
        onTapGhost={onTapGhost}
        onHandleMove={onHandleMove}
      />

      <div class="map-status">
        <Status
          busy={busy}
          blank={blank}
          drawing={drawing}
          edited={edited}
          result={result}
          drawMode={drawMode}
          section={section}
          removal={removal}
          choice={choice}
          extendFailure={extendFailure}
        />
      </div>

      {section || choice || removal ? null : (
        <div class="seed-row">
          <label class="seed-label" for="seed-input">
            {t('generate.seed')}
          </label>
          <input
            id="seed-input"
            class="seed-input"
            type="text"
            inputMode="text"
            autocomplete="off"
            spellcheck={false}
            value={seedLabel}
            onChange={(event) => onSeedChange(event.currentTarget.value)}
          />
        </div>
      )}

      {choice ? (
        <ActionBar>
          <button type="button" class="action" onClick={onCancelChoice}>
            {t('branch.cancel')}
          </button>
          {choice.options.map((option, index) => (
            <button key={index} type="button" class="action primary" onClick={() => onTapGhost(index)}>
              {index + 1}. {option.label}
            </button>
          ))}
        </ActionBar>
      ) : removal ? (
        <ActionBar>
          <button type="button" class="action" onClick={onUndoRemove}>
            {t('gap.undo')}
          </button>
          <button type="button" class="action primary" onClick={onFillGap}>
            {t('gap.fill')}
          </button>
          <button
            type="button"
            class={drawMode ? 'action primary active' : 'action primary'}
            aria-pressed={drawMode}
            onClick={() => onDrawModeChange(!drawMode)}
          >
            {drawMode ? t('draw.cancel') : t('section.draw')}
          </button>
        </ActionBar>
      ) : section ? (
        <ActionBar>
          <button type="button" class="action narrow" aria-label={t('section.clear')} onClick={() => onTapPiece(null)}>
            ✕
          </button>
          <button type="button" class="action primary" disabled={!section.section.replaceable} onClick={onSolve}>
            {t('section.options')}
          </button>
          <button
            type="button"
            class={drawMode ? 'action primary active' : 'action primary'}
            aria-pressed={drawMode}
            disabled={!section.section.replaceable}
            onClick={() => onDrawModeChange(!drawMode)}
          >
            {drawMode ? t('draw.cancel') : t('section.draw')}
          </button>
          <button type="button" class="action" disabled={!section.section.replaceable} onClick={onRemove}>
            {t('section.remove')}
          </button>
        </ActionBar>
      ) : (
        <ActionBar>
          <button
            type="button"
            class={drawMode ? 'action active' : 'action'}
            aria-pressed={drawMode}
            onClick={() => onDrawModeChange(!drawMode)}
          >
            {drawMode ? t('draw.cancel') : t('draw.start')}
          </button>
          {/* Tyhjällä pöydällä sama nappi tuo generoidun radan takaisin: se ei
              kadonnut mihinkään, se on yhä siemenensä takana. */}
          <button type="button" class="action" onClick={onClear} disabled={blank || !track}>
            {t('generate.clear')}
          </button>
          {/* Neljä nappia mahtuu puhelimen leveyteen vain lyhyillä nimillä,
              joten "Generoi" kertoo saman kuin "Generoi uudelleen". */}
          <button type="button" class="action primary" onClick={onRegenerate} disabled={busy}>
            {t('generate.generate')}
          </button>
          <button type="button" class="action" onClick={onShowResult} disabled={!track}>
            {t('generate.showResult')}
          </button>
        </ActionBar>
      )}
    </div>
  )
}

/**
 * Kartan kulmatunnus: yhden palan osiosta näytetään palan tunnus, koska
 * "mikä pala tämä on" on juuri se mitä yhtä palaa napautettaessa kysytään.
 * Pidemmän osion mitat kertoo statusrivi, eikä samaa toisteta kartan päällä.
 */
function badgeFor(section: SectionState | null, removal: RemovalState | null, track: Track | null): string | null {
  if (removal) return null
  if (!section || !track || section.section.indices.length !== 1) return null
  return track.pieces[section.section.indices[0]]?.pieceId ?? null
}

interface StatusProps {
  busy: boolean
  blank: boolean
  drawMode: boolean
  drawing: DrawingState | null
  edited: EditState | null
  section: SectionState | null
  removal: RemovalState | null
  choice: EditChoice | null
  extendFailure: ExtendReason | null
  result: GenerateResult | null
}

/** Statusrivi kertoo aina mitä kartalla näkyy ja miksi — myös kun mikään ei onnistunut. */
function Status({ busy, blank, drawMode, drawing, edited, section, removal, choice, extendFailure, result }: StatusProps) {
  // Haaraa kysytään piirron jälkeen, muut vaihtoehdot autosolverilta: sama
  // haamukuvio, mutta käyttäjä on kysynyt kahta eri asiaa.
  if (choice) return <span>{t(choice.options[0]?.kind === 'branch' ? 'branch.choose' : 'edit.choose')}</span>
  if (removal) {
    if (drawMode) return <span>{t('section.drawHint')}</span>
    return (
      <span>
        {t('gap.open', { length: formatCm(removal.gap.lengthMm) })}{' '}
        <span class="muted">{t('section.freed', { pieces: describePieces(removal.gap.freed) })}</span>
      </span>
    )
  }
  if (section) {
    if (drawMode) return <span>{t('section.drawHint')}</span>
    return <SectionStatus section={section} />
  }
  if (drawMode) return <span>{t('draw.hint')}</span>
  if (busy) return <span>{t('generate.working')}</span>
  if (extendFailure) return <span class="warning">{describeExtendFailure(extendFailure)}</span>

  if (edited) {
    const summary = describeEdit(edited)
    if (edited.withinInventory) return <span>{summary}</span>
    return (
      <span>
        {summary} <span class="warning">{t('draw.shortage', { pieces: describePieces(edited.track.shortages) })}</span>
      </span>
    )
  }

  if (drawing) {
    const { result: fit } = drawing
    if (!fit.track) return <span class="warning">{describeFitFailure(fit.reason)}</span>

    const summary = t('draw.fitted', {
      pieces: formatNumber(fit.track.pieces.length),
      length: formatMetres(fit.track.lengthMm),
      deviation: formatNumber(Math.round(fit.deviation.meanMm)),
    })
    if (fit.withinInventory) return <span>{summary}</span>
    return (
      <span>
        {summary} <span class="warning">{t('draw.shortage', { pieces: describePieces(fit.track.shortages) })}</span>
      </span>
    )
  }

  // Tyhjä pöytä on tila eikä virhe: kartalla ei ole rataa, koska käyttäjä pyysi
  // niin. Generoinnin epäonnistuminen on eri asia ja sanotaan erikseen.
  if (blank) return <span>{t('generate.blank')}</span>

  const winner = result?.winner ?? null
  if (!winner) return <span class="warning">{describeFailure(result?.rejections ?? [])}</span>
  return (
    <span>
      {t('generate.summary', {
        pieces: formatNumber(winner.track.pieces.length),
        length: formatMetres(winner.track.lengthMm),
        tightness: formatPercent(winner.track.closure.tightnessPct),
      })}
    </span>
  )
}

/**
 * Mitä viimeksi tehtiin. Piirretty korvaus kertoo poikkeamansa piirretystä
 * viivasta; valmis ehdotus taas kertoo mikä se oli ja mitä se maksaa paloina —
 * poikkeamaa ei ole, koska mitään ei piirretty.
 */
function describeEdit(edited: EditState): string {
  if (edited.kind === 'replace') {
    return t('section.replaced', {
      pieces: formatNumber(edited.pieceCount),
      length: formatMetres(edited.track.lengthMm),
      deviation: formatNumber(Math.round(edited.deviationMm)),
    })
  }
  if (edited.kind === 'branch') {
    return t('branch.added', {
      pieces: formatNumber(edited.pieceCount),
      length: formatMetres(edited.track.lengthMm),
      change: describeChange(edited),
    })
  }
  return t('edit.applied', {
    what: edited.label ?? '',
    pieces: formatNumber(edited.pieceCount),
    length: formatMetres(edited.track.lengthMm),
    change: describeChange(edited),
  })
}

/**
 * Osuuden tehtävänanto käyttäjälle (README luku 6): "82 cm, sivutilaa 25 cm
 * vasemmalla". Epäonnistuneen yrityksen syy näkyy saman rivin jatkona, jotta
 * kartta pysyy sankarina eikä dialogeja tarvita.
 */
function SectionStatus({ section }: { section: SectionState }) {
  const { brief } = section
  const summary = t('section.brief', {
    length: formatCm(brief.lengthMm),
    pieces: formatNumber(brief.pieceCount),
    left: formatCm(brief.leftMm),
    right: formatCm(brief.rightMm),
  })

  const note = section.note
    ? describeSectionNote(section.note)
    : !section.section.replaceable
      ? t('section.notReplaceable')
      : null

  if (note) {
    return (
      <span>
        {summary} <span class="warning">{note}</span>
      </span>
    )
  }
  return (
    <span>
      {summary} <span class="muted">{t('section.freed', { pieces: describePieces(brief.freed) })}</span>
    </span>
  )
}

/** Palamuutoskortti (README luku 6): "käyttää 1×L · vapauttaa 1×D". */
function describeChange(edited: EditState): string {
  if (!edited.change) return ''
  const { added, removed } = edited.change
  if (Object.keys(removed).length === 0) return t('branch.uses', { added: describePieces(added) })
  return t('branch.change', { added: describePieces(added), removed: describePieces(removed) })
}

/** "2×E, 1×D" — lyhyt lista, ei koko ostoslistaa; se on sivulla 4. */
function describePieces(shortages: Record<string, number>): string {
  return Object.entries(shortages)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([id, count]) => t('draw.shortageItem', { count: formatNumber(count), piece: pieceName(id) }))
    .join(', ')
}
