import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { defaultLibrary } from '../core/library'
import { seedFromInput, seedToString } from '../core/rng'
import {
  extendTrack,
  fillGap,
  naturalSection,
  removeSection,
  replaceSection,
  sectionBrief,
  slideSectionEnd,
  solveSection,
  type ExtendReason,
} from '../edit'
import { fitDrawing } from '../fit'
import { generate, type GenerateResult } from '../gen/generate'
import { t } from '../i18n'
import {
  branchChoice,
  editStateOf,
  ghostsOf,
  handlesOf,
  netChange,
  solveChoice,
  type ChoiceOption,
  type DrawingState,
  type EditChoice,
  type EditState,
  type RemovalState,
  type SectionState,
} from './drawing'
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
  /** Viimeisin raakaveto: se jää kartalle haaleana radan alle (README luku 5). */
  const [guide, setGuide] = useState<Point[] | null>(null)
  const [edited, setEdited] = useState<EditState | null>(null)
  const [section, setSection] = useState<SectionState | null>(null)
  const [drawMode, setDrawMode] = useState(false)
  // Ratkaisematta oleva kysymys: haamut kartalla odottavat napautusta
  // (README luku 6 — epäselvyydet ratkaistaan kartalla, ei dialogeilla).
  const [choice, setChoice] = useState<EditChoice | null>(null)
  /** Poistettu osio odottamassa täyttöä, piirtoa tai kumoamista. */
  const [removal, setRemoval] = useState<RemovalState | null>(null)
  const [extendFailure, setExtendFailure] = useState<ExtendReason | null>(null)

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

  /** Muokkauksen asetukset yhdestä paikasta: sama kokoelma joka koneistolle. */
  const editOptions = useMemo(
    () => ({
      area: settings.area,
      library,
      inventory: toInventory(settings),
      flex: toFlexSettings(settings),
    }),
    [settings, library],
  )

  /** Osion valinta ja sen tehtävänanto samasta paikasta, myös kahvaa vedettäessä. */
  const selectSection = useCallback(
    (next: SectionState['section'] | null, note: SectionState['note'] = null) => {
      if (!next || !track) {
        setSection(null)
        return
      }
      setSection({ section: next, brief: sectionBrief(track, library, settings.area, next), handles: handlesOf(next), note })
    },
    [track, library, settings.area],
  )

  const handleTapPiece = useCallback(
    (index: number | null) => {
      setDrawMode(false)
      // Kysymys tai aukko on kartalla auki: napautus radan päälle sulkee sen sen
      // sijaan että valitsisi osion. Vasta sitten kartta palaa katseluun.
      if (choice) {
        setChoice(null)
        return
      }
      if (removal) {
        setRemoval(null)
        return
      }
      if (index === null || !track) {
        setSection(null)
        return
      }
      selectSection(naturalSection(track, library, index))
    },
    [track, library, selectSection, choice, removal],
  )

  /** Vaihtoehdon valinta: haamun napautus tai toimintorivin nappi (README luku 6). */
  const applyChoice = useCallback((option: ChoiceOption) => {
    setChoice(null)
    setExtendFailure(null)
    setSection(null)
    setRemoval(null)
    setDrawing(null)
    setEdited(editStateOf(option))
  }, [])

  const handleTapGhost = useCallback(
    (index: number) => {
      const option = choice?.options[index]
      if (option) applyChoice(option)
    },
    [choice, applyChoice],
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
   * "Vaihtoehdot": autosolver vastaa osuuden tehtävänantoon 2–4 valmiilla
   * ehdotuksella. Tyhjä vastaus on sekin vastaus, ja se sanotaan suoraan.
   */
  const handleSolve = useCallback(() => {
    if (!section || !track) return
    setDrawMode(false)
    setRemoval(null)
    const options = solveSection(track, section.section, editOptions)
    if (options.length === 0) {
      selectSection(section.section, { kind: 'no-options' })
      return
    }
    setChoice(solveChoice(options))
  }, [section, track, editOptions, selectSection])

  /** "Poista": osio purkautuu ja jättää aukkomerkin (README luku 6). */
  const handleRemove = useCallback(() => {
    if (!section || !track) return
    setDrawMode(false)
    setChoice(null)
    const removed = removeSection(track, section.section, editOptions)
    if (!removed.track || !removed.gap) {
      selectSection(section.section, { kind: 'fill', reason: removed.reason === 'ok' ? 'no-fill' : removed.reason })
      return
    }
    setRemoval({ preview: removed.track, gap: removed.gap })
  }, [section, track, editOptions, selectSection])

  /** Aukon automaattinen täyttö Solverilla. */
  const handleFillGap = useCallback(() => {
    if (!section || !track) return
    const filled = fillGap(track, section.section, editOptions)
    if (!filled.track) {
      // Aukko sulkeutuu, valinta jää: käyttäjä voi venyttää sitä kahvoista tai
      // piirtää tilalle, ja statusrivi kertoo miksi täyttö ei onnistunut.
      setRemoval(null)
      selectSection(section.section, { kind: 'fill', reason: filled.reason })
      return
    }
    setRemoval(null)
    setSection(null)
    setDrawing(null)
    setEdited({
      track: filled.track,
      kind: 'fill',
      label: t('gap.fill'),
      pieceCount: filled.pieceCount,
      deviationMm: 0,
      withinInventory: filled.withinInventory,
      change: netChange(filled.added, filled.removed),
    })
  }, [section, track, editOptions])

  /**
   * Sovitus on synkronista ja nopeaa, joten se ajetaan suoraan sormen noustessa.
   * Veto tulkitaan kolmella tavalla: valittu osio ohjaa sen korvaukseksi, radan
   * vierestä alkava veto on uusi haara, ja muualta alkava veto on uusi rata.
   */
  const handleDraw = useCallback(
    (points: Point[]) => {
      setDrawMode(false)
      setGuide(points)
      setExtendFailure(null)

      if (section && track) {
        const replacement = replaceSection(track, section.section, points, editOptions)
        if (!replacement.track) {
          selectSection(section.section, { kind: 'replace', reason: replacement.reason })
          return
        }
        // Osion indeksit viittaavat vanhaan rataan, joten valinta puretaan.
        setSection(null)
        setRemoval(null)
        setEdited({
          track: replacement.track,
          kind: 'replace',
          label: null,
          pieceCount: replacement.pieceCount,
          deviationMm: replacement.deviation.meanMm,
          withinInventory: replacement.withinInventory,
          change: null,
        })
        return
      }

      // Nappausetäisyydellä alkava veto on lisäävä piirto (README luku 5).
      // "not-on-track" on ainoa syy palata uuden radan piirtoon: muut syyt
      // kertovat että käyttäjä tarkoitti haaraa muttei saanut sitä.
      if (track) {
        const extended = extendTrack(track, points, editOptions)
        if (extended.reason !== 'not-on-track') {
          if (extended.options.length === 0) {
            setChoice(null)
            setExtendFailure(extended.reason)
            return
          }
          const choices = branchChoice(extended.options, points)
          if (extended.automatic) applyChoice(choices.options[0])
          else setChoice(choices)
          return
        }
      }

      setEdited(null)
      setChoice(null)
      setDrawing({ points, result: fitDrawing(points, editOptions) })
    },
    [editOptions, section, track, selectSection, applyChoice],
  )

  /** Asetusten tai siemenen muutos mitätöi kaiken käsityön: se on tehty vanhaan rataan. */
  const resetEdits = () => {
    setDrawing(null)
    setGuide(null)
    setEdited(null)
    setSection(null)
    setDrawMode(false)
    setChoice(null)
    setRemoval(null)
    setExtendFailure(null)
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
            guide={edited?.kind === 'replace' ? null : guide}
            edited={edited}
            section={section}
            removal={removal}
            choice={choice}
            ghosts={choice ? ghostsOf(choice.options) : null}
            extendFailure={extendFailure}
            onDrawModeChange={setDrawMode}
            onDraw={handleDraw}
            onTapPiece={handleTapPiece}
            onTapGhost={handleTapGhost}
            onCancelChoice={() => setChoice(null)}
            onSolve={handleSolve}
            onRemove={handleRemove}
            onFillGap={handleFillGap}
            onUndoRemove={() => setRemoval(null)}
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
