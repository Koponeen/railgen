import { t } from '../i18n'
import type { Mode } from './state'

interface ToolbarProps {
  mode: Mode
  canUndo: boolean
  canRedo: boolean
  onToggleDraw: () => void
  onUndo: () => void
  onRedo: () => void
  onFit: () => void
}

export function Toolbar({ mode, canUndo, canRedo, onToggleDraw, onUndo, onRedo, onFit }: ToolbarProps) {
  const drawing = mode === 'draw'
  return (
    <div id="toolbar" role="toolbar" aria-label={t('toolbar.label')}>
      <button id="btn-draw" type="button" aria-pressed={drawing} class={drawing ? 'active' : ''} onClick={onToggleDraw}>
        ✏️ {t('toolbar.draw')}
      </button>
      <button id="btn-undo" type="button" disabled={!canUndo} onClick={onUndo}>
        ↶ {t('toolbar.undo')}
      </button>
      <button id="btn-redo" type="button" disabled={!canRedo} onClick={onRedo}>
        ↷ {t('toolbar.redo')}
      </button>
      <button id="btn-fit" type="button" onClick={onFit}>
        ⤢ {t('toolbar.fit')}
      </button>
    </div>
  )
}
