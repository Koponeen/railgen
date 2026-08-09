import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { defaultLibrary } from '../core/library'
import { seedFromInput, seedToString } from '../core/rng'
import { generate, type GenerateResult } from '../gen/generate'
import { t } from '../i18n'
import { AreaPage } from './pages/AreaPage'
import { GeneratePage } from './pages/GeneratePage'
import { InventoryPage } from './pages/InventoryPage'
import { ResultPage } from './pages/ResultPage'
import { readSharedSettings } from './share'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  toFlexSettings,
  toInventory,
  type AppSettings,
} from './settings'

const PAGES = ['area', 'inventory', 'generate', 'result'] as const
type PageId = (typeof PAGES)[number]

function randomSeed(): string {
  return seedToString(Math.floor(Math.random() * 0x100000000))
}

/**
 * Sovelluksen juuri: sivut 1, 2, 3-minimi ja 4. Preact omistaa kromin,
 * kartta on imperatiivinen saareke sen sisällä.
 *
 * Ensikäytössä lineaarinen polku 1 -> 2 -> 3 -> 4; kun localStoragessa on
 * asetukset, palataan suoraan sivulle 3 (UI-linjaus 5).
 */
export function App() {
  const library = useMemo(() => defaultLibrary(), [])

  const [settings, setSettings] = useState<AppSettings>(() => {
    const shared = typeof window === 'undefined' ? null : readSharedSettings(window.location.search)
    return shared ?? loadSettings() ?? DEFAULT_SETTINGS
  })
  const [page, setPage] = useState<PageId>(() => {
    if (typeof window !== 'undefined' && readSharedSettings(window.location.search)) return 'generate'
    return loadSettings() ? 'generate' : 'area'
  })

  const [seed, setSeed] = useState<string>(() => settings.seed || randomSeed())
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [busy, setBusy] = useState(false)
  const pendingRef = useRef<number | null>(null)

  useEffect(() => {
    saveSettings({ ...settings, seed })
  }, [settings, seed])

  const run = useCallback(
    (nextSeed: string) => {
      setBusy(true)
      if (pendingRef.current !== null) window.clearTimeout(pendingRef.current)
      // Generointi on synkronista mutta voi viedä satoja millisekunteja
      // puhelimella, joten annetaan selaimen piirtää "generoidaan" ensin.
      pendingRef.current = window.setTimeout(() => {
        setResult(
          generate({
            seed: nextSeed,
            area: settings.area,
            inventory: toInventory(settings),
            flex: toFlexSettings(settings),
          }),
        )
        setBusy(false)
        pendingRef.current = null
      }, 0)
    },
    [settings],
  )

  // Rata generoidaan uudelleen aina kun asetukset tai siemen muuttuvat, mutta
  // vain kun sitä ollaan katsomassa.
  useEffect(() => {
    if (page === 'generate' || page === 'result') run(seed)
  }, [page, seed, run])

  const patch = (next: Partial<AppSettings>) => setSettings((current) => ({ ...current, ...next }))
  const winner = result?.winner ?? null
  const seedLabel = useMemo(() => seedToString(seedFromInput(seed)), [seed])

  return (
    <div id="app">
      <main class="page-host">
        {page === 'area' ? <AreaPage area={settings.area} onChange={(area) => patch({ area })} /> : null}
        {page === 'inventory' ? <InventoryPage settings={settings} library={library} onChange={patch} /> : null}
        {page === 'generate' ? (
          <GeneratePage
            area={settings.area}
            library={library}
            result={result}
            busy={busy}
            seedLabel={seed}
            onSeedChange={setSeed}
            onRegenerate={() => setSeed(randomSeed())}
            onShowResult={() => setPage('result')}
          />
        ) : null}
        {page === 'result' ? (
          <ResultPage
            area={settings.area}
            library={library}
            track={winner?.track ?? null}
            settings={settings}
            seedLabel={seedLabel}
          />
        ) : null}
      </main>

      <nav class="tabs" aria-label={t('nav.label')}>
        {PAGES.map((id, index) => (
          <button
            key={id}
            type="button"
            class={id === page ? 'tab active' : 'tab'}
            aria-current={id === page ? 'page' : undefined}
            onClick={() => setPage(id)}
          >
            <span class="tab-index">{index + 1}</span>
            <span class="tab-label">{t(`nav.${id}`)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
