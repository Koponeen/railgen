import { t } from '../i18n'
import type { MapEngineSnapshot } from './mapEngine'

interface HudProps {
  snapshot: MapEngineSnapshot
}

/** Pieni tilaosoitin testausta varten: tila, zoom, viivamäärä, valinta. */
export function Hud({ snapshot }: HudProps) {
  const summary = t('hud.summary', {
    mode: t(`hud.mode.${snapshot.mode}`),
    zoom: snapshot.zoom.toFixed(2),
    count: snapshot.lineCount,
  })
  return (
    <div id="hud" aria-hidden="true">
      {summary}
      {snapshot.selected ? ` · ${t('hud.selected')}` : ''}
    </div>
  )
}
