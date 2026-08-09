import { t } from '../../i18n'
import { formatMetres, formatNumber, formatPercent } from '../../i18n/format'
import type { PieceLibrary } from '../../core/library'
import type { GenerateResult } from '../../gen/generate'
import type { AreaShape } from '../../gen/mask'
import { ActionBar } from '../components'
import { describeFailure } from '../failure'
import { TrackMap } from '../TrackMap'

interface GeneratePageProps {
  area: AreaShape
  library: PieceLibrary
  result: GenerateResult | null
  busy: boolean
  seedLabel: string
  onSeedChange: (seed: string) => void
  onRegenerate: () => void
  onShowResult: () => void
}

/**
 * Sivu 3 minimiversiona (R2): generoi uudelleen + siemenen näyttö. Piirto ja
 * muokkaus tulevat myöhemmissä vaiheissa samaan näkymään.
 */
export function GeneratePage({
  area,
  library,
  result,
  busy,
  seedLabel,
  onSeedChange,
  onRegenerate,
  onShowResult,
}: GeneratePageProps) {
  const winner = result?.winner ?? null

  return (
    <div class="page map-page">
      <TrackMap area={area} track={winner?.track ?? null} library={library} />

      <div class="map-status">
        {busy ? (
          <span>{t('generate.working')}</span>
        ) : winner ? (
          <span>
            {t('generate.summary', {
              pieces: formatNumber(winner.track.pieces.length),
              length: formatMetres(winner.track.lengthMm),
              tightness: formatPercent(winner.track.closure.tightnessPct),
            })}
          </span>
        ) : (
          <span class="warning">{describeFailure(result?.rejections ?? [])}</span>
        )}
      </div>

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
        <button type="button" class="action primary" onClick={onRegenerate} disabled={busy}>
          {t('generate.regenerate')}
        </button>
        <button type="button" class="action" onClick={onShowResult} disabled={!winner}>
          {t('generate.showResult')}
        </button>
      </ActionBar>
    </div>
  )
}
