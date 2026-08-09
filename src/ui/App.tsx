import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { defaultLibrary } from '../core/library'
import { seedFromInput, seedToString } from '../core/rng'
import { naturalSection, replaceSection, sectionBrief, slideSectionEnd } from '../edit'
import { fitDrawing } from '../fit'
import { generate, type GenerateResult } from '../gen/generate'
import { t } from '../i18n'
import { handlesOf, type DrawingState, type EditState, type SectionState } from './drawing'
import type { HandleId, Point } from './state'
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
 * Sovelluksen juuri: sivut 1, 2, 3 ja 4. Preact omistaa kromin, kartta on
 * imperatiivinen saareke sen sisällä.
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

  // Piirretty ja käsin muokattu rata syrjäyttävät generoidun, kunnes käyttäjä
  // generoi uudelleen tai muuttaa asetuksia. Kaikki elävät rinnakkain, joten
  // paluu on aina auki.
  const [drawing, setDrawing] = useState<DrawingState | null>(null)
  const [edited, setEdited] = useState<EditState | null>(null)
  const [section, setSection] = useState<SectionState | null>(null)
  const [drawMode, setDrawMode] = useState(false)

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

  const winner = result?.winner ?? null
  const track = edited?.track ?? drawing?.result.track ?? winner?.track ?? null

  /** Osion valinta ja sen tehtävänanto samasta paikasta, myös kahvaa vedettäessä. */
  const selectSection = useCallback(
    (next: SectionState['section'] | null, failure: SectionState['failure'] = null) => {
      if (!next || !track) {
        setSection(null)
        return
      }
      setSection({ section: next, brief: sectionBrief(track, library, settings.area, next), handles: handlesOf(next), failure })
    },
    [track, library, settings.area],
  )

  const handleTapPiece = useCallback(
    (index: number | null) => {
      setDrawMode(false)
      if (index === null || !track) {
        setSection(null)
        return
      }
      selectSection(naturalSection(track, library, index))
    },
    [track, library, selectSection],
  )

  /** Päätykahva napsahtaa lähimpään palarajaan sormen alla (README luku 6). */
  const handleHandleMove = useCallback(
    (handle: HandleId, point: Point) => {
      if (!section || !track) return
      const next = slideSectionEnd(track, library, section.section, handle, point)
      if (next.indices.join() === section.section.indices.join()) return
      selectSection(next)
    },
    [section, track, library, selectSection],
  )

  /**
   * Sovitus on synkronista ja nopeaa, joten se ajetaan suoraan sormen noustessa.
   * Valittu osio ohjaa vedon korvaukseksi; ilman valintaa veto on uusi rata.
   */
  const handleDraw = useCallback(
    (points: Point[]) => {
      setDrawMode(false)
      const options = {
        area: settings.area,
        library,
        inventory: toInventory(settings),
        flex: toFlexSettings(settings),
      }

      if (section && track) {
        const replacement = replaceSection(track, section.section, points, options)
        if (!replacement.track) {
          selectSection(section.section, replacement.reason)
          return
        }
        // Osion indeksit viittaavat vanhaan rataan, joten valinta puretaan.
        setSection(null)
        setEdited({
          track: replacement.track,
          pieceCount: replacement.pieceCount,
          deviationMm: replacement.deviation.meanMm,
          withinInventory: replacement.withinInventory,
        })
        return
      }

      setEdited(null)
      setDrawing({ points, result: fitDrawing(points, options) })
    },
    [settings, library, section, track, selectSection],
  )

  /** Asetusten tai siemenen muutos mitätöi kaiken käsityön: se on tehty vanhaan rataan. */
  const resetEdits = () => {
    setDrawing(null)
    setEdited(null)
    setSection(null)
    setDrawMode(false)
  }

  const patch = (next: Partial<AppSettings>) => {
    resetEdits()
    setSettings((current) => ({ ...current, ...next }))
  }

  const startOver = (nextSeed: string) => {
    resetEdits()
    setSeed(nextSeed)
  }

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
            drawMode={drawMode}
            drawing={drawing}
            edited={edited}
            section={section}
            onDrawModeChange={setDrawMode}
            onDraw={handleDraw}
            onTapPiece={handleTapPiece}
            onHandleMove={handleHandleMove}
            onSeedChange={startOver}
            onRegenerate={() => startOver(randomSeed())}
            onShowResult={() => setPage('result')}
          />
        ) : null}
        {page === 'result' ? (
          <ResultPage
            area={settings.area}
            library={library}
            track={track}
            settings={settings}
            seedLabel={seedLabel}
            drawn={drawing?.result.track != null || edited != null}
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
