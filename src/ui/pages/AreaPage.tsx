import { t } from '../../i18n'
import { formatCm } from '../../i18n/format'
import type { AreaShape } from '../../gen/mask'
import { CELL_MM } from '../../core/units'
import { Card, Choice, Page, Stepper } from '../components'
import { AREA_MAX_MM, AREA_MIN_MM, AREA_STEP_MM, QUICK_SIZES, normalizeArea } from '../settings'
import { areaOutlinePoints } from '../trackSvg'

interface AreaPageProps {
  area: AreaShape
  onChange: (area: AreaShape) => void
}

/** Sivu 1: alue. Korkeintaan neljä lukua (README luku 7). */
export function AreaPage({ area, onChange }: AreaPageProps) {
  const set = (patch: Partial<AreaShape>) => onChange(normalizeArea({ ...area, ...patch } as AreaShape))

  const cells = Math.floor(area.widthMm / CELL_MM) * Math.floor(area.depthMm / CELL_MM)

  return (
    <Page>
      <Card title={t('area.title')}>
        <Choice
          label={t('area.shape')}
          value={area.kind}
          options={[
            { value: 'rect', label: t('area.shapeRect') },
            { value: 'L', label: t('area.shapeL') },
          ]}
          onChange={(kind) =>
            onChange(
              normalizeArea(
                kind === 'rect'
                  ? { kind: 'rect', widthMm: area.widthMm, depthMm: area.depthMm }
                  : {
                      kind: 'L',
                      widthMm: area.widthMm,
                      depthMm: area.depthMm,
                      cutWidthMm: 800,
                      cutDepthMm: 700,
                      corner: 'ne',
                    },
              ),
            )
          }
        />

        <Stepper
          label={t('area.width')}
          value={area.widthMm}
          min={AREA_MIN_MM}
          max={AREA_MAX_MM}
          step={AREA_STEP_MM}
          unit={t('common.cm')}
          format={formatCm}
          onChange={(widthMm) => set({ widthMm })}
        />
        <Stepper
          label={t('area.depth')}
          value={area.depthMm}
          min={AREA_MIN_MM}
          max={AREA_MAX_MM}
          step={AREA_STEP_MM}
          unit={t('common.cm')}
          format={formatCm}
          onChange={(depthMm) => set({ depthMm })}
        />

        {area.kind === 'L' ? (
          <>
            <Stepper
              label={t('area.cutWidth')}
              value={area.cutWidthMm}
              min={AREA_STEP_MM}
              max={area.widthMm - AREA_STEP_MM * 2}
              step={AREA_STEP_MM}
              unit={t('common.cm')}
              format={formatCm}
              onChange={(cutWidthMm) => set({ cutWidthMm } as Partial<AreaShape>)}
            />
            <Stepper
              label={t('area.cutDepth')}
              value={area.cutDepthMm}
              min={AREA_STEP_MM}
              max={area.depthMm - AREA_STEP_MM * 2}
              step={AREA_STEP_MM}
              unit={t('common.cm')}
              format={formatCm}
              onChange={(cutDepthMm) => set({ cutDepthMm } as Partial<AreaShape>)}
            />
            <Choice
              label={t('area.corner')}
              value={area.corner}
              options={[
                { value: 'nw', label: t('area.cornerNw') },
                { value: 'ne', label: t('area.cornerNe') },
                { value: 'sw', label: t('area.cornerSw') },
                { value: 'se', label: t('area.cornerSe') },
              ]}
              onChange={(corner) => set({ corner } as Partial<AreaShape>)}
            />
          </>
        ) : null}
      </Card>

      <Card title={t('area.quickSizes')}>
        <div class="quick-sizes">
          {QUICK_SIZES.map((size) => (
            <button key={size.key} type="button" class="quick-size" onClick={() => onChange(size.area)}>
              <span class="quick-size-name">{t(`area.quick.${size.key}`)}</span>
              <span class="quick-size-dims">
                {formatCm(size.area.widthMm)} × {formatCm(size.area.depthMm)} {t('common.cm')}
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card title={t('area.preview')}>
        <AreaPreview area={area} />
        <p class="hint">{t('area.cells', { count: cells })}</p>
      </Card>
    </Page>
  )
}

function AreaPreview({ area }: { area: AreaShape }) {
  const points = areaOutlinePoints(area)
    .map((point) => `${point.x},${point.y}`)
    .join(' ')
  return (
    <svg class="area-preview" viewBox={`-40 -40 ${area.widthMm + 80} ${area.depthMm + 80}`} role="img" aria-label={t('area.preview')}>
      <polygon points={points} class="area-preview-shape" />
    </svg>
  )
}
