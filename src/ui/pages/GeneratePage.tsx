import { t } from '../../i18n'
import { formatMetres, formatNumber, formatPercent } from '../../i18n/format'
import { pieceName } from '../../i18n/pieces'
import type { PieceLibrary } from '../../core/library'
import type { GenerateResult } from '../../gen/generate'
import type { AreaShape } from '../../gen/mask'
import { ActionBar } from '../components'
import { describeFailure } from '../failure'
import { describeFitFailure, type DrawingState } from '../drawing'
import type { Point } from '../state'
import { TrackMap } from '../TrackMap'

interface GeneratePageProps {
  area: AreaShape
  library: PieceLibrary
  result: GenerateResult | null
  busy: boolean
  seedLabel: string
  /** Piirtotila päällä: yksi sormi piirtää, kaksi navigoi. */
  drawMode: boolean
  /** Viimeisin piirretty rata, tai null jos näytössä on generoitu rata. */
  drawing: DrawingState | null
  onDrawModeChange: (drawing: boolean) => void
  onDraw: (points: Point[]) => void
  onSeedChange: (seed: string) => void
  onRegenerate: () => void
  onShowResult: () => void
}

/**
 * Sivu 3: generointi ja piirto samassa näkymässä (R2). Kartta on sankari, ja
 * epäselvyydet kerrotaan kartan alla olevalla statusrivillä — ei dialogeina.
 */
export function GeneratePage({
  area,
  library,
  result,
  busy,
  seedLabel,
  drawMode,
  drawing,
  onDrawModeChange,
  onDraw,
  onSeedChange,
  onRegenerate,
  onShowResult,
}: GeneratePageProps) {
  const winner = result?.winner ?? null
  const track = drawing?.result.track ?? winner?.track ?? null

  return (
    <div class="page map-page">
      <TrackMap
        area={area}
        track={track}
        library={library}
        mode={drawMode ? 'draw' : 'view'}
        guide={drawing?.points ?? null}
        onDraw={onDraw}
        onSelect={(snapshot) => {
          // Kartta palauttaa tilan katseluun itse, kun veto on ohi.
          if (snapshot.mode === 'view' && drawMode) onDrawModeChange(false)
        }}
      />

      <div class="map-status">{<Status busy={busy} drawing={drawing} result={result} drawMode={drawMode} />}</div>

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
    </div>
  )
}

interface StatusProps {
  busy: boolean
  drawMode: boolean
  drawing: DrawingState | null
  result: GenerateResult | null
}

/** Statusrivi kertoo aina mitä kartalla näkyy ja miksi — myös kun mikään ei onnistunut. */
function Status({ busy, drawMode, drawing, result }: StatusProps) {
  if (drawMode) return <span>{t('draw.hint')}</span>
  if (busy) return <span>{t('generate.working')}</span>

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
        {summary} <span class="warning">{t('draw.shortage', { pieces: describeShortages(fit.track.shortages) })}</span>
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

/** "2×E, 1×D" — lyhyt lista, ei koko ostoslistaa; se on sivulla 4. */
function describeShortages(shortages: Record<string, number>): string {
  return Object.entries(shortages)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([id, count]) => t('draw.shortageItem', { count: formatNumber(count), piece: pieceName(id) }))
    .join(', ')
}
