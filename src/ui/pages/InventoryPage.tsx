import { useState } from 'preact/hooks'
import { t } from '../../i18n'
import { pieceName } from '../../i18n/pieces'
import type { PieceLibrary } from '../../core/library'
import { Card, Choice, Page, Stepper, Toggle } from '../components'
import { pieceGroups } from '../pieceGroups'
import { INVENTORY_PRESETS, type AppSettings } from '../settings'

interface InventoryPageProps {
  settings: AppSettings
  library: PieceLibrary
  onChange: (patch: Partial<AppSettings>) => void
}

/** Sivu 2: palat. Skippaus tuottaa ostoslistan (README luku 7). */
export function InventoryPage({ settings, library, onChange }: InventoryPageProps) {
  const [showAll, setShowAll] = useState(false)
  const groups = pieceGroups(library, !showAll)

  const setCount = (id: string, count: number) => {
    const next = { ...settings.inventoryCounts }
    if (count > 0) next[id] = count
    else delete next[id]
    onChange({ inventoryCounts: next })
  }

  const total = Object.values(settings.inventoryCounts).reduce((sum, count) => sum + count, 0)

  return (
    <Page>
      <Card title={t('inventory.title')}>
        <Choice
          label={t('inventory.mode')}
          value={settings.skipInventory ? 'skip' : 'own'}
          options={[
            { value: 'own', label: t('inventory.modeOwn') },
            { value: 'skip', label: t('inventory.modeSkip') },
          ]}
          onChange={(mode) => onChange({ skipInventory: mode === 'skip' })}
        />
        <p class="hint">{settings.skipInventory ? t('inventory.skipHint') : t('inventory.ownHint', { count: total })}</p>
      </Card>

      {settings.skipInventory ? null : (
        <>
          <Card title={t('inventory.presets')}>
            <div class="quick-sizes">
              {INVENTORY_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  class="quick-size"
                  onClick={() => onChange({ inventoryCounts: { ...preset.counts } })}
                >
                  <span class="quick-size-name">{t(`inventory.preset.${preset.key}`)}</span>
                  <span class="quick-size-dims">
                    {t('inventory.pieceCount', {
                      count: Object.values(preset.counts).reduce((sum, count) => sum + count, 0),
                    })}
                  </span>
                </button>
              ))}
            </div>
            <p class="hint">{t('inventory.presetHint')}</p>
          </Card>

          {groups.map((group) => (
            <Card key={group.id} title={t(`inventory.group.${group.id}`)}>
              {group.pieces.map((piece) => (
                <Stepper
                  key={piece.id}
                  label={pieceName(piece.id)}
                  value={settings.inventoryCounts[piece.id] ?? 0}
                  min={0}
                  max={99}
                  step={1}
                  onChange={(count) => setCount(piece.id, count)}
                />
              ))}
            </Card>
          ))}

          <Card>
            <Toggle
              label={t('inventory.showAll')}
              hint={t('inventory.showAllHint')}
              checked={showAll}
              onChange={setShowAll}
            />
          </Card>
        </>
      )}

      <Card title={t('inventory.flex')}>
        <Toggle
          label={t('inventory.flexEnabled')}
          hint={settings.skipInventory ? t('inventory.flexSkipHint') : t('inventory.flexHint')}
          checked={settings.flex.enabled && !settings.skipInventory}
          onChange={(enabled) => onChange({ flex: { ...settings.flex, enabled } })}
        />
        {settings.flex.enabled && !settings.skipInventory ? (
          <Stepper
            label={t('inventory.flexCount')}
            value={settings.flex.count}
            min={1}
            max={9}
            step={1}
            onChange={(count) => onChange({ flex: { ...settings.flex, count } })}
          />
        ) : null}
      </Card>
    </Page>
  )
}
