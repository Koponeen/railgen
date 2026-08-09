import { useRef, useState } from 'preact/hooks'
import { t } from '../../i18n'
import { formatCm, formatMetres, formatNumber, formatPercent } from '../../i18n/format'
import { pieceName } from '../../i18n/pieces'
import type { PieceLibrary } from '../../core/library'
import type { Track } from '../../gen/build'
import type { AreaShape } from '../../gen/mask'
import { ActionBar, Card } from '../components'
import { exportTrackPng } from '../exportPng'
import { sortForPartsList } from '../pieceGroups'
import { buildShareUrl } from '../share'
import type { AppSettings } from '../settings'
import { TrackMap } from '../TrackMap'

interface ResultPageProps {
  area: AreaShape
  library: PieceLibrary
  track: Track | null
  settings: AppSettings
  seedLabel: string
}

/** Sivu 4: tulos. Kuva, mitat, osaluettelo, vienti ja jako (README luku 7). */
export function ResultPage({ area, library, track, settings, seedLabel }: ResultPageProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'too-long' | 'failed'>('idle')

  if (!track) {
    return (
      <div class="page">
        <Card>
          <p class="hint">{t('result.empty')}</p>
        </Card>
      </div>
    )
  }

  const widthMm = track.bbox.maxX - track.bbox.minX
  const depthMm = track.bbox.maxY - track.bbox.minY
  const partIds = sortForPartsList(library, Object.keys(track.usage))
  const shortageIds = sortForPartsList(library, Object.keys(track.shortages))
  const totalPieces = Object.values(track.usage).reduce((sum, count) => sum + count, 0)

  const share = async () => {
    const link = buildShareUrl({ ...settings, seed: seedLabel }, window.location.href)
    if (link.tooLong) {
      setShareState('too-long')
      return
    }
    try {
      if (navigator.share) await navigator.share({ url: link.url, title: t('app.title') })
      else await navigator.clipboard.writeText(link.url)
      setShareState('copied')
    } catch {
      setShareState('failed')
    }
  }

  return (
    <div class="page result-page">
      <div class="result-map">
        <TrackMap area={area} track={track} library={library} svgRef={svgRef} />
      </div>

      <Card title={t('result.title')}>
        <dl class="stats">
          <div>
            <dt>{t('result.length')}</dt>
            <dd>{t('common.metres', { value: formatMetres(track.lengthMm) })}</dd>
          </div>
          <div>
            <dt>{t('result.extents')}</dt>
            <dd>
              {formatCm(widthMm)} × {formatCm(depthMm)} {t('common.cm')}
            </dd>
          </div>
          <div>
            <dt>{t('result.pieces')}</dt>
            <dd>{formatNumber(totalPieces)}</dd>
          </div>
          <div>
            <dt>{t('result.tightness')}</dt>
            <dd>{formatPercent(track.closure.tightnessPct)}</dd>
          </div>
          {track.maxLevel > 0 ? (
            <div>
              <dt>{t('result.levels')}</dt>
              <dd>{formatNumber(track.maxLevel + 1)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('generate.seed')}</dt>
            <dd class="mono">{seedLabel}</dd>
          </div>
        </dl>
      </Card>

      <Card title={settings.skipInventory ? t('result.shoppingList') : t('result.partsList')}>
        <ul class="parts-list">
          {partIds.map((id) => (
            <li key={id}>
              <span class="part-name">{pieceName(id)}</span>
              <span class="part-id mono">{id}</span>
              <span class="part-count">{formatNumber(track.usage[id])}</span>
            </li>
          ))}
        </ul>
      </Card>

      {shortageIds.length > 0 ? (
        <Card title={t('result.missing')}>
          <ul class="parts-list warning">
            {shortageIds.map((id) => (
              <li key={id}>
                <span class="part-name">{pieceName(id)}</span>
                <span class="part-id mono">{id}</span>
                <span class="part-count">{formatNumber(track.shortages[id])}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {shareState !== 'idle' ? (
        <p class={shareState === 'copied' ? 'hint' : 'hint warning'}>{t(`result.share.${shareState}`)}</p>
      ) : null}

      <ActionBar>
        <button
          type="button"
          class="action"
          onClick={() => svgRef.current && void exportTrackPng(svgRef.current, area.widthMm, area.depthMm)}
        >
          {t('result.png')}
        </button>
        <button type="button" class="action" onClick={() => window.print()}>
          {t('result.print')}
        </button>
        <button type="button" class="action primary" onClick={() => void share()}>
          {t('result.share.button')}
        </button>
      </ActionBar>
    </div>
  )
}
