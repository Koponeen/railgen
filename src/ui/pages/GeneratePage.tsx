import { t } from '../../i18n'
import { formatCm, formatMetres, formatNumber, formatPercent } from '../../i18n/format'
import { pieceName } from '../../i18n/pieces'
import type { PieceLibrary } from '../../core/library'
import type { Track } from '../../gen/build'
import type { GenerateResult } from '../../gen/generate'
import type { AreaShape } from '../../gen/mask'
import { ActionBar } from '../components'
import { describeFailure } from '../failure'
import {
  describeFitFailure,
  describeReplaceFailure,
  type DrawingState,
  type EditState,
  type SectionState,
} from '../drawing'
import type { HandleId, Point } from '../state'
import { TrackMap } from '../TrackMap'

interface GeneratePageProps {
  area: AreaShape
  library: PieceLibrary
  result: GenerateResult | null
  busy: boolean
  seedLabel: string
  /** Piirtotila päällä: yksi sormi piirtää, kaksi navigoi. */
  drawMode: boolean
  /** Viimeisin vapaalla kädellä piirretty rata, tai null. */
  drawing: DrawingState | null
  /** Käsin muokattu rata, joka syrjäyttää generoidun ja piirretyn. */
  edited: EditState | null
  /** Valittu osio ja sen tehtävänanto, tai null. */
  section: SectionState | null
  onDrawModeChange: (drawing: boolean) => void
  onDraw: (points: Point[]) => void
  onTapPiece: (index: number | null) => void
  onHandleMove: (handle: HandleId, point: Point) => void
  onSeedChange: (seed: string) => void
  onRegenerate: () => void
  onShowResult: () => void
}

/**
 * Sivu 3: generointi, piirto ja muokkaus samassa näkymässä (R2). Kartta on
 * sankari, ja epäselvyydet kerrotaan kartan alla olevalla statusrivillä — ei
 * dialogeina. Toimintorivi vaihtuu sen mukaan onko osio valittuna.
 */
export function GeneratePage({
  area,
  library,
  result,
  busy,
  seedLabel,
  drawMode,
  drawing,
  edited,
  section,
  onDrawModeChange,
  onDraw,
  onTapPiece,
  onHandleMove,
  onSeedChange,
  onRegenerate,
  onShowResult,
}: GeneratePageProps) {
  const winner = result?.winner ?? null
  const track = edited?.track ?? drawing?.result.track ?? winner?.track ?? null

  return (
    <div class="page map-page">
      <TrackMap
        area={area}
        track={track}
        library={library}
        mode={drawMode ? 'draw' : 'view'}
        guide={edited ? null : drawing?.points ?? null}
        selection={section?.section.indices ?? null}
        handles={section?.handles ?? null}
        badge={badgeFor(section, track)}
        onDraw={onDraw}
        onTapPiece={onTapPiece}
        onHandleMove={onHandleMove}
      />

      <div class="map-status">
        <Status busy={busy} drawing={drawing} edited={edited} result={result} drawMode={drawMode} section={section} />
      </div>

      {section ? null : (
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

      {section ? (
        <ActionBar>
          <button type="button" class="action" onClick={() => onTapPiece(null)}>
            {t('section.clear')}
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
          <button type="button" class="action primary" onClick={onRegenerate} disabled={busy}>
            {t('generate.regenerate')}
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
function badgeFor(section: SectionState | null, track: Track | null): string | null {
  if (!section || !track || section.section.indices.length !== 1) return null
  return track.pieces[section.section.indices[0]]?.pieceId ?? null
}

interface StatusProps {
  busy: boolean
  drawMode: boolean
  drawing: DrawingState | null
  edited: EditState | null
  section: SectionState | null
  result: GenerateResult | null
}

/** Statusrivi kertoo aina mitä kartalla näkyy ja miksi — myös kun mikään ei onnistunut. */
function Status({ busy, drawMode, drawing, edited, section, result }: StatusProps) {
  if (section) {
    if (drawMode) return <span>{t('section.drawHint')}</span>
    return <SectionStatus section={section} />
  }
  if (drawMode) return <span>{t('draw.hint')}</span>
  if (busy) return <span>{t('generate.working')}</span>

  if (edited) {
    const summary = t('section.replaced', {
      pieces: formatNumber(edited.pieceCount),
      length: formatMetres(edited.track.lengthMm),
      deviation: formatNumber(Math.round(edited.deviationMm)),
    })
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
 * Osuuden tehtävänanto käyttäjälle (README luku 6): "82 cm, sivutilaa 25 cm
 * vasemmalla". Epäonnistuneen korvauksen syy näkyy saman rivin jatkona, jotta
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

  const note = section.failure
    ? describeReplaceFailure(section.failure)
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

/** "2×E, 1×D" — lyhyt lista, ei koko ostoslistaa; se on sivulla 4. */
function describePieces(shortages: Record<string, number>): string {
  return Object.entries(shortages)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([id, count]) => t('draw.shortageItem', { count: formatNumber(count), piece: pieceName(id) }))
    .join(', ')
}
