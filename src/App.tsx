import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { saveKeyForAccount } from './auth/auth'
import { AuthScreen } from './components/AuthScreen'
import { AwaySummary } from './components/AwaySummary'
import { CraftPanel } from './components/CraftPanel'
import { FactoryFloor } from './components/FactoryFloor'
import { GoalsBar } from './components/GoalsBar'
import { HabitsPanel } from './components/HabitsPanel'
import { InventoryPanel } from './components/InventoryPanel'
import { ResearchPanel } from './components/ResearchPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { SkillsPanel } from './components/SkillsPanel'
import { StepsPanel } from './components/StepsPanel'
import { TutorialOverlay } from './components/TutorialOverlay'
import { GameProvider, useGame } from './game/GameContext'
import { useHealthSteps } from './hooks/useHealthSteps'
import { usePedometer } from './hooks/usePedometer'
import { useSectionSwipe } from './hooks/useSectionSwipe'
import { getTutorialStep, unlockedTabsFor } from './game/tutorial'
import {
  tutorialChecklist,
  tutorialHighlightFor,
  tutorialRecommendedTool,
} from './game/tutorialGuide'
import { contractComplete } from './game/contracts'
import type { TabId } from './game/types'
import './index.css'

const TABS: { id: TabId; label: string; short: string }[] = [
  { id: 'inventory', label: 'Inventory', short: 'Inv' },
  { id: 'steps', label: 'Steps', short: 'Steps' },
  { id: 'craft', label: 'Craft', short: 'Craft' },
  { id: 'factory', label: 'Factory', short: 'Factory' },
  { id: 'research', label: 'Research', short: 'Lab' },
  { id: 'skills', label: 'Skills', short: 'Skills' },
  { id: 'habits', label: 'Tasks', short: 'Tasks' },
]

function TabIcon({ id }: { id: TabId }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (id) {
    case 'factory':
      return (
        <svg {...common}>
          <path d="M3 20V9l5 3V9l5 3V5l8 4v11H3z" />
          <path d="M7 20v-3M12 20v-2M17 20v-4" />
        </svg>
      )
    case 'inventory':
      return (
        <svg {...common}>
          <rect x="4" y="6" width="16" height="13" rx="1.5" />
          <path d="M4 10h16M9 6V4h6v2" />
        </svg>
      )
    case 'steps':
      return (
        <svg {...common}>
          <path d="M7 20c1.5-3 2-6 2-9M12 20c1-2.5 1.5-5 1.5-8M17 19c.8-2 1.2-4.2 1.2-7" />
          <circle cx="9" cy="8" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="13.5" cy="9" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="18.2" cy="9.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'craft':
      return (
        <svg {...common}>
          <path d="M14.5 5.5 18 9l-8.5 8.5H6v-3.5L14.5 5.5z" />
          <path d="M12.5 7.5 16 11" />
          <path d="M4 20h16" />
        </svg>
      )
    case 'research':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="5.5" />
          <path d="M14.5 14.5 20 20" />
          <path d="M8 10h4M10 8v4" />
        </svg>
      )
    case 'skills':
      return (
        <svg {...common}>
          <path d="M12 3 14.2 8.5 20 9.2l-4.2 3.8L17 19l-5-2.8L7 19l1.2-6L4 9.2l5.8-.7L12 3z" />
        </svg>
      )
    case 'habits':
      return (
        <svg {...common}>
          <path d="M5 6h14M5 12h14M5 18h10" />
          <path d="M16.5 16.5 18 18l3-3.5" />
        </svg>
      )
    default:
      return null
  }
}

function toastTone(message: string): 'ok' | 'warn' | 'info' {
  if (
    /need |required|full|fail|blocked|nothing|no |already |not finished|skip|empty|chest empty/i.test(
      message,
    )
  ) {
    return 'warn'
  }
  if (
    /complete|researched|fueled|finished|queued|pasted|copied|hand-crafting|synced|planted|tour complete|tour restarted|claimed|stamped|focus:|name saved/i.test(
      message,
    )
  ) {
    return 'ok'
  }
  return 'info'
}

function Toast() {
  const { state, clearToast } = useGame()
  if (!state.unlockedToast) return null
  const tone = toastTone(state.unlockedToast)
  return (
    <div className={`toast is-${tone}`} role="status">
      <span>{state.unlockedToast}</span>
      <button type="button" onClick={clearToast} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}

function Shell() {
  const [tab, setTab] = useState<TabId>('factory')
  const { state, logSteps, importHealthSteps, cloudSync } = useGame()
  const pedometer = usePedometer(logSteps)
  const healthSteps = useHealthSteps()
  const [healthBootDone, setHealthBootDone] = useState(!healthSteps.isNative)
  const syncingRef = useRef(false)
  const readIfAuthorized = healthSteps.readTodayStepsIfAuthorized
  const isNative = healthSteps.isNative
  const requestTab = useCallback((t: TabId) => setTab(t), [])
  const playing = tab === 'factory'

  const syncHealthQuiet = useCallback(async () => {
    if (!isNative || syncingRef.current) return
    syncingRef.current = true
    try {
      const total = await readIfAuthorized()
      if (total != null) importHealthSteps(total, { quiet: true })
    } finally {
      syncingRef.current = false
    }
  }, [isNative, readIfAuthorized, importHealthSteps])
  // DEBUG: Expose logSteps for testing
  useEffect(() => {
    window.__debugLogSteps = logSteps
    return () => { delete window.__debugLogSteps }
  }, [logSteps])

  // Auto-pull Health steps on login/boot so drills mine before the away recap.
  useEffect(() => {
    if (!isNative) {
      setHealthBootDone(true)
      return
    }
    let cancelled = false
    let delayId = 0
    let capId = 0
    void (async () => {
      // Wait for GameProvider's first catch-up tick so offlineReport exists.
      await new Promise<void>((resolve) => {
        delayId = window.setTimeout(resolve, 400)
      })
      if (cancelled) return
      await Promise.race([
        syncHealthQuiet(),
        new Promise<void>((resolve) => {
          capId = window.setTimeout(resolve, 4500)
        }),
      ])
      if (!cancelled) setHealthBootDone(true)
    })()
    return () => {
      cancelled = true
      window.clearTimeout(delayId)
      window.clearTimeout(capId)
    }
  }, [isNative, syncHealthQuiet])

  // Re-sync after cloud hydrate lands a save, and whenever the app resumes.
  useEffect(() => {
    if (!isNative) return
    if (cloudSync === 'syncing') return
    if (!healthBootDone) return
    void syncHealthQuiet()
  }, [isNative, cloudSync, healthBootDone, syncHealthQuiet])

  useEffect(() => {
    if (!isNative) return
    let remove: (() => void) | undefined
    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return
      window.setTimeout(() => {
        void syncHealthQuiet()
      }, 500)
    }).then((handle) => {
      remove = () => {
        void handle.remove()
      }
    })
    function onVisible() {
      if (document.visibilityState === 'visible') {
        window.setTimeout(() => {
          void syncHealthQuiet()
        }, 500)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      remove?.()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isNative, syncHealthQuiet])

  const tutorialStep = getTutorialStep(
    state.tutorialComplete ? null : state.tutorialStep,
  )
  const unlocked = useMemo(
    () => unlockedTabsFor(state.tutorialStep, state.tutorialComplete),
    [state.tutorialStep, state.tutorialComplete],
  )
  const tourChecks = useMemo(
    () => tutorialChecklist(state, tutorialStep),
    [state, tutorialStep],
  )
  const highlight = tutorialHighlightFor(
    tutorialStep,
    tutorialRecommendedTool(tourChecks, tutorialStep?.autoSelect),
  )
  const coaching = Boolean(tutorialStep && tutorialStep.mode === 'coach')

  const setTabSafe = useCallback(
    (t: TabId) => {
      if (t !== 'settings' && !unlocked.includes(t)) return
      setTab(t)
    },
    [unlocked],
  )

  const swipeTabs = useMemo(
    () => TABS.map((t) => t.id).filter((id) => unlocked.includes(id)),
    [unlocked],
  )

  const onSectionSwipe = useCallback(
    (dir: -1 | 1) => {
      if (tab === 'settings') {
        setTabSafe('factory')
        return
      }
      const idx = swipeTabs.indexOf(tab)
      if (idx < 0) return
      const next = swipeTabs[idx + dir]
      if (next) setTabSafe(next)
    },
    [tab, swipeTabs, setTabSafe],
  )

  const sectionSwipe = useSectionSwipe(
    true,
    onSectionSwipe,
    // Map pan, build rail, overlays, and the dock keep their own gestures.
    '.factory-viewport, .build-rail, .inspect-modal, .bottom-nav, .tutorial-root, .toast, .away-root, .minimap, .viewport-fabs, .game-hud',
  )

  const sheetLabel =
    tab === 'settings'
      ? 'Settings'
      : (TABS.find((t) => t.id === tab)?.label ?? '')

  return (
    <div
      className={[
        'app',
        'app-game',
        playing ? 'is-playing' : 'has-sheet',
        coaching ? 'is-coaching' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDown={sectionSwipe.onPointerDown}
      onPointerUp={sectionSwipe.onPointerUp}
      onPointerCancel={sectionSwipe.onPointerCancel}
    >
      <div className="atmosphere" aria-hidden>
        <div className="belt-strip" />
        <div className="haze" />
        <div className="grid-floor" />
      </div>

      {/* Factory stays mounted so the world keeps feeling alive under sheets */}
      <div className={`game-stage ${playing ? 'is-front' : 'is-back'}`}>
        <FactoryFloor
          highlight={highlight}
          active={playing}
          onOpenTasks={() => setTabSafe('habits')}
          onOpenSteps={() => setTabSafe('steps')}
          onOpenSettings={() => setTabSafe('settings')}
        />
      </div>

      {!playing && (
        <div className="game-sheet" role="dialog" aria-label={sheetLabel}>
          <header className="game-sheet-bar">
            <div className="game-sheet-heading">
              <h2 className="game-sheet-title">{sheetLabel}</h2>
              <p className="game-sheet-sub">
                {state.playerName} · Lv {state.level} · {state.stepsToday.toLocaleString()} steps
              </p>
            </div>
          </header>
          <main className="game-sheet-body" key={tab}>
            {tab === 'inventory' && <InventoryPanel />}
            {tab === 'steps' && (
              <StepsPanel
                pedometer={pedometer}
                healthSteps={healthSteps}
                highlightWalk={highlight === 'walkSteps'}
              />
            )}
            {tab === 'skills' && <SkillsPanel />}
            {tab === 'craft' && <CraftPanel />}
            {tab === 'research' && <ResearchPanel />}
            {tab === 'settings' && <SettingsPanel />}
            {tab === 'habits' && (
              <div className="section-tasks">
                <GoalsBar />
                <HabitsPanel highlightHabit={highlight === 'habit'} />
              </div>
            )}
          </main>
        </div>
      )}

      <nav className="bottom-nav game-dock" aria-label="Game sections">
        {TABS.map((t) => {
          const locked = !unlocked.includes(t.id)
          const focus = tutorialStep?.tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              className={[
                'bottom-nav-btn',
                tab === t.id ? 'is-active' : '',
                locked ? 'is-locked' : '',
                focus ? 'is-tour-focus' : '',
                t.id === 'factory' ? 'is-floor-btn' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setTabSafe(t.id)}
              disabled={locked}
              title={locked ? 'Finish the tour to unlock' : t.label}
            >
              <span className="bottom-nav-icon">
                <TabIcon id={t.id} />
              </span>
              <span className="bottom-nav-label">{t.short}</span>
              {t.id === 'craft' && state.craftQueue.length > 0 && (
                <span className="bottom-nav-live">{state.craftQueue.length}</span>
              )}
              {t.id === 'habits' &&
                (state.contracts ?? []).some(
                  (c) => !c.claimed && contractComplete(state, c),
                ) && <span className="bottom-nav-live">!</span>}
            </button>
          )
        })}
      </nav>

      <TutorialOverlay onRequestTab={requestTab} />
      <AwaySummary holdForHealthSync={isNative && !healthBootDone} />
      <Toast />
    </div>
  )
}

function AuthenticatedApp() {
  const { session } = useAuth()
  if (!session) return <AuthScreen />

  return (
    <GameProvider
      key={session.accountId}
      saveKey={saveKeyForAccount(session.accountId)}
      displayName={session.displayName}
      enableCloudSync={session.provider === 'google' && !session.isGuest}
    >
      <Shell />
    </GameProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  )
}

// DEBUG: Expose logSteps for testing
declare global {
  interface Window {
    __debugLogSteps?: (amount: number) => void
  }
}
