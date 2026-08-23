import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import {
  APP_NAME,
  ITEM_META,
  PLACEABLE_META,
  RECIPE_MAP,
  formatNum,
  idx,
  inserterCooldownFor,
  isBeltKind,
  isDrillKind,
  isEntityPlaceable,
  isFurnaceKind,
  isInserterKind,
  rockVariant,
  sizeOf,
  STARTER_PAD,
  treeVariant,
  footprintCells,
  placeOriginFromTap,
  drillOutputCells,
  xpForLevel,
} from '../game/data'
import { getBeltBend } from '../game/beltShape'
import { useGame } from '../game/GameContext'
import { inserterIoAt } from '../game/grid'
import { activeGoal } from '../game/goals'
import { contractComplete } from '../game/contracts'
import {
  canPlaceFootprint,
  drillHasOre,
  fuelAllDrills,
  fuelDrillAt,
  placeEntity,
} from '../game/logic'
import { machineStatus } from '../game/machineStatus'
import { countPlacedChests, maxChestsFor } from '../game/research'
import {
  generatorCount,
  powerCapacity,
  powerDemand,
  powerFraction,
  powerPerStep,
  powerNet,
  tileIsPoweredFloor,
} from '../game/power'
import { skillBonuses } from '../game/skills'
import {
  stockOf,
  sumChestStores,
  warehouseHudAmount,
} from '../game/chestInventory'
import {
  getActiveTutorialStep,
  placeFailReason,
  suggestPlaceDir,
  tutorialChecklist,
  tutorialGhosts,
  tutorialRecommendedTool,
  tutorialToolsFor,
} from '../game/tutorialGuide'
import {
  TOOL_TABS,
  isEditMetaTool,
  tabForTool,
  tabTools,
  type ToolTab,
} from '../game/toolTabs'
import {
  DroneSprite,
  ItemSprite,
  ToolIcon,
} from '../sprites/Sprites'
import { CELL, FloorCell, StoreTags, storeHasItems } from './FactoryFloorCell'
import { useProductionRates } from '../hooks/useProductionRates'
import { MachineInventory, hasMachineInventory } from './MachineInventory'
import { resolveTheme, subscribeTheme } from '../theme'
import type { Entity, GameState, ItemId, Placeable, ToolId } from '../game/types'

const ZOOM_MIN = 0.45
const ZOOM_MAX = 2.2
/** Extra tiles rendered past the viewport so trees and 3x3 buildings do not pop. */
const CULL_PAD = 2
/** Touch browsers often report movementX/Y as 0 - use client deltas instead. */
const PAN_SLOP = 10

/** Extra pixels past the map edge so you can see you've hit the border. */
const PAN_EDGE_SLACK = 56

/** Keep the factory grid near the viewport - slight overscroll shows the map edge. */
function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  viewport: { width: number; height: number },
  mapW: number,
  mapH: number,
): { x: number; y: number } {
  const vw = viewport.width
  const vh = viewport.height
  if (vw <= 0 || vh <= 0) return pan

  const worldW = mapW * CELL * zoom
  const worldH = mapH * CELL * zoom
  const slack = PAN_EDGE_SLACK

  let x: number
  let y: number
  if (worldW <= vw) {
    const center = (vw - worldW) / 2
    x = Math.min(center + slack, Math.max(center - slack, pan.x))
  } else {
    x = Math.min(slack, Math.max(vw - worldW - slack, pan.x))
  }
  if (worldH <= vh) {
    const center = (vh - worldH) / 2
    y = Math.min(center + slack, Math.max(center - slack, pan.y))
  } else {
    y = Math.min(slack, Math.max(vh - worldH - slack, pan.y))
  }
  return { x, y }
}

function visibleCellRange(
  pan: { x: number; y: number },
  zoom: number,
  viewport: { width: number; height: number },
  mapW: number,
  mapH: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const cell = CELL * zoom
  const vw = viewport.width > 0 ? viewport.width : 1024
  const vh = viewport.height > 0 ? viewport.height : 768
  const x0 = Math.max(0, Math.floor(-pan.x / cell) - CULL_PAD)
  const y0 = Math.max(0, Math.floor(-pan.y / cell) - CULL_PAD)
  const x1 = Math.min(mapW - 1, Math.ceil((vw - pan.x) / cell) + CULL_PAD)
  const y1 = Math.min(mapH - 1, Math.ceil((vh - pan.y) / cell) + CULL_PAD)
  return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) }
}
const HUD_RESOURCES: ItemId[] = [
  'ironOre',
  'copperOre',
  'coal',
  'ironPlate',
  'copperPlate',
  'gear',
  'steel',
  'wood',
  'stone',
]

type Highlight =
  | 'ore'
  | 'roboportTool'
  | 'drillTool'
  | 'beltTool'
  | 'inserterTool'
  | 'chestTool'
  | 'furnaceTool'
  | 'walkSteps'
  | 'habit'
  | null
type Floater = {
  id: number
  x: number
  y: number
  text: string
  tone: 'ore' | 'place' | 'good' | 'warn'
  /** When set, the floater shows this resource's icon (e.g. mined ore). */
  item?: ItemId
}

function dirArrow(dir: Entity['dir']): string {
  return { N: '↑', E: '→', S: '↓', W: '←' }[dir]
}

function isUnlocked(tool: ToolId, researched: string[]): boolean {
  if (
    tool === 'remove' ||
    tool === 'rotate' ||
    tool === 'flip' ||
    tool === 'copy' ||
    tool === 'paste' ||
    tool === 'drill' ||
    tool === 'belt' ||
    tool === 'inserter' ||
    tool === 'furnace' ||
    tool === 'chest' ||
    tool === 'assembler' ||
    tool === 'roboport' ||
    tool === 'generator' ||
    tool === 'foundation'
  ) {
    return true
  }
  if (tool === 'fastBelt') return researched.includes('logistics2')
  if (tool === 'electricDrill') return researched.includes('electricMining')
  if (tool === 'splitter') return researched.includes('splitters')
  if (tool === 'undergroundBelt') return researched.includes('undergroundBelts')
  if (tool === 'steelFurnace') return researched.includes('steelProcessing')
  if (tool === 'longInserter') return researched.includes('longInserters')
  return false
}

function needsPlaceDir(tool: ToolId | null): boolean {
  if (!tool) return false
  if (tool === 'rotate') return true
  if (isEditMetaTool(tool)) return false
  if (tool === 'chest' || tool === 'foundation' || tool === 'generator') return false
  return true
}

function canPlaceAt(tool: ToolId | null, x: number, y: number, state: GameState): boolean {
  if (!tool || isEditMetaTool(tool)) return false
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return false
  if (tool === 'foundation') {
    if (state.tiles[idx(x, y)].foundation) return false
    return Math.floor((state.inventory.foundation ?? 0) + 1e-9) >= 1
  }
  if (!isEntityPlaceable(tool)) return false
  if (!canPlaceFootprint(state, tool, x, y)) return false
  if ((tool === 'drill' || tool === 'electricDrill') && !drillHasOre(state, x, y))
    return false
  if (tool === 'chest') {
    if (countPlacedChests(state.entities) >= maxChestsFor(state.researched, state.completedGoals)) return false
  }
  const meta = PLACEABLE_META[tool]
  return Math.floor((state.inventory[meta.inventoryKey] ?? 0) + 1e-9) >= 1
}

function buzz(ms = 12) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* ignore */
  }
}

let floaterSeq = 0

/** Stable empty results so the grid stays frozen (no re-render churn) while hidden. */
const EMPTY_IO: { pickup: Set<string>; drop: Set<string> } = {
  pickup: new Set(),
  drop: new Set(),
}
const EMPTY_BENDS = new Map<string, ReturnType<typeof getBeltBend>>()
const EMPTY_GHOSTS: ReturnType<typeof tutorialGhosts> = []

export function FactoryFloor({
  highlight = null,
  active = true,
  onOpenTasks,
  onOpenSteps,
  onOpenSettings,
}: {
  highlight?: Highlight
  /** False while a sheet/tab covers the factory - skip all per-tick render work. */
  active?: boolean
  onOpenTasks: () => void
  onOpenSteps: () => void
  onOpenSettings: () => void
}) {
  const {
    state,
    place,
    rotateAt,
    flipAt,
    selectTool,
    rotateDir,
    flipDir,
    fuelDrills,
    fuelAt,
    selected,
    placeDir,
    placeFlip,
  } = useGame()
  const { width, height, tiles, entities, copyCorner, blueprint } = state
  const inserterCd = inserterCooldownFor(
    skillBonuses(state.skills).inserterSpeedMult,
  )
  const rates = useProductionRates(state.stats)
  const goal = activeGoal(state)
  const goalProg = goal?.progress?.(state) ?? null
  const claimableContracts = (state.contracts ?? []).filter(
    (c) => !c.claimed && contractComplete(state, c),
  )
  const activeCraft = state.craftQueue[0]
  const activeCraftRecipe = activeCraft ? RECIPE_MAP[activeCraft.recipeId] : null
  const craftPct = activeCraft
    ? Math.min(100, (activeCraft.elapsed / activeCraft.duration) * 100)
    : 0
  const xpNeeded = xpForLevel(state.level)
  const xpPct = Math.min(100, (state.xp / xpNeeded) * 100)
  const powerCap = powerCapacity(state)
  const powerFrac = powerFraction(state)
  const powerStored = Math.floor(state.power)
  const powerStep = powerPerStep(state)
  const powerUse = powerDemand(state)
  const genCount = generatorCount(state)
  const powerLevel = powerFrac <= 0 ? 'is-empty' : powerFrac < 0.25 ? 'is-low' : 'is-ok'
  const floorNet = powerNet(state)
  const hasBattery = state.power > 0
  const busyPorts = useMemo(() => {
    const ids = new Set<string>()
    for (const d of state.drones) {
      if (d.state !== 'idle') ids.add(d.homeId)
    }
    return ids
  }, [state.drones])
  const tourStep = getActiveTutorialStep(state)
  const tourChecks = useMemo(
    () => tutorialChecklist(state, tourStep),
    [state, tourStep],
  )
  const tourTool = tutorialRecommendedTool(tourChecks, tourStep?.autoSelect)
  const planGhosts = useMemo(
    () => (active ? tutorialGhosts(state, tourStep, tourTool) : EMPTY_GHOSTS),
    [state, tourStep, tourTool, active],
  )
  const ghostAt = useMemo(() => {
    const map = new Map<string, (typeof planGhosts)[number]>()
    for (const g of planGhosts) map.set(`${g.x},${g.y}`, g)
    return map
  }, [planGhosts])

  const [toolTab, setToolTab] = useState<ToolTab>('production')
  const lastToolByTab = useRef<Partial<Record<ToolTab, ToolId>>>({})
  const [zoom, setZoom] = useState(0.85)
  const [pan, setPan] = useState({ x: 12, y: 48 })
  const [viewSize, setViewSize] = useState({ width: 1024, height: 768 })
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [inspect, setInspect] = useState<{ x: number; y: number } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [floaters, setFloaters] = useState<Floater[]>([])
  const [stepPulse, setStepPulse] = useState(false)
  const [railOpen, setRailOpen] = useState(false)
  const [paintActive, setPaintActive] = useState(false)
  // Default: one-finger drag pans. Opt in to paint lines by dragging.
  const [dragBuild, setDragBuild] = useState(false)
  const [resPulse, setResPulse] = useState<Partial<Record<ItemId, boolean>>>({})
  const [namedMat, setNamedMat] = useState<ItemId | null>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const prevChestStock = useRef(sumChestStores(state))

  const openInspect = useCallback((cell: { x: number; y: number }) => {
    setInspect(cell)
  }, [])

  const closeInspect = useCallback(() => {
    setInspect(null)
  }, [])

  const placeOrigin = useMemo(() => {
    if (!hover || !selected || isEditMetaTool(selected)) return null
    if (!isEntityPlaceable(selected)) return { x: hover.x, y: hover.y }
    return placeOriginFromTap(selected, hover.x, hover.y)
  }, [hover, selected])

  const hoverDir =
    placeOrigin && selected && !isEditMetaTool(selected)
      ? suggestPlaceDir(state, selected, placeOrigin.x, placeOrigin.y)
      : placeDir

  const hoverFootprint = useMemo(() => {
    if (!hover || !selected || isEditMetaTool(selected) || !placeOrigin) return null
    const cells = isEntityPlaceable(selected)
      ? footprintCells(selected, placeOrigin.x, placeOrigin.y)
      : [{ x: hover.x, y: hover.y }]
    const valid = canPlaceAt(selected, placeOrigin.x, placeOrigin.y, state)
    return {
      valid,
      keys: new Set(cells.map((c) => `${c.x},${c.y}`)),
    }
  }, [hover, selected, state, placeOrigin])

  const pickTool = useCallback(
    (list: ToolId[]) => {
      const unlocked = list.filter((t) => isUnlocked(t, state.researched))
      const stocked = unlocked.find((t) => {
        if (isEditMetaTool(t)) return true
        return (state.inventory[t as Placeable] ?? 0) > 0
      })
      return stocked ?? unlocked[0] ?? null
    },
    [state.researched, state.inventory],
  )
  const viewportRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const viewportSize = useRef({ width: 0, height: 0 })
  const cameraRef = useRef({ zoom, width, height })
  cameraRef.current = { zoom, width, height }
  const panRef = useRef(pan)
  panRef.current = pan
  const prevSteps = useRef(state.stepsToday)
  const prevOre = useRef(state.stats.oreMined)
  const prevCycles = useRef(state.mineCycles)
  const holdTimer = useRef(0)
  const gesture = useRef<{
    kind: 'none' | 'pending' | 'pan' | 'paint' | 'pinch'
    startZoom: number
    startDist: number
    startPan: { x: number; y: number } | null
    startMid: { x: number; y: number } | null
    moved: boolean
    lastCell: string | null
    origin: { x: number; y: number } | null
    last: { x: number; y: number } | null
    pointerId: number | null
  }>({
    kind: 'none',
    startZoom: 1,
    startDist: 0,
    startPan: null,
    startMid: null,
    moved: false,
    lastCell: null,
    origin: null,
    last: null,
    pointerId: null,
  })

  const isDragPaintTool = (tool: ToolId | null) =>
    tool === 'belt' ||
    tool === 'fastBelt' ||
    tool === 'undergroundBelt' ||
    tool === 'remove' ||
    tool === 'rotate' ||
    tool === 'inserter' ||
    tool === 'longInserter' ||
    tool === 'foundation' ||
    tool === 'flip'

  const inspectEnt = useMemo(() => {
    if (!inspect) return null
    const id = tiles[idx(inspect.x, inspect.y)]?.entityId
    return id ? entities[id] ?? null : null
  }, [inspect, tiles, entities])

  const inspectTile = useMemo(() => {
    if (!inspect) return null
    return tiles[idx(inspect.x, inspect.y)] ?? null
  }, [inspect, tiles])

  const spawnFloater = useCallback(
    (
      x: number,
      y: number,
      text: string,
      tone: Floater['tone'] = 'good',
      item?: ItemId,
    ) => {
      const id = ++floaterSeq
      setFloaters((list) => [...list.slice(-18), { id, x, y, text, tone, item }])
      window.setTimeout(() => {
        setFloaters((list) => list.filter((f) => f.id !== id))
      }, 900)
    },
    [],
  )

  // Step pulse + ore floaters when the factory mines
  useEffect(() => {
    if (state.stepsToday > prevSteps.current) {
      setStepPulse(true)
      window.setTimeout(() => setStepPulse(false), 420)
    }
    prevSteps.current = state.stepsToday
  }, [state.stepsToday])

  useEffect(() => {
    const prev = prevChestStock.current
    const now = sumChestStores(state)
    const gained: ItemId[] = []
    for (const id of HUD_RESOURCES) {
      if ((now[id] ?? 0) > (prev[id] ?? 0)) gained.push(id)
    }
    prevChestStock.current = now
    if (!gained.length) return
    setResPulse((p) => {
      const next = { ...p }
      for (const id of gained) next[id] = true
      return next
    })
    const t = window.setTimeout(() => {
      setResPulse((p) => {
        const next = { ...p }
        for (const id of gained) delete next[id]
        return next
      })
    }, 420)
    return () => window.clearTimeout(t)
  }, [state.entities])

  useEffect(() => {
    if (!namedMat) return
    const t = window.setTimeout(() => setNamedMat(null), 1800)
    return () => window.clearTimeout(t)
  }, [namedMat])

  useLayoutEffect(() => {
    const el = hudRef.current
    const floor = el?.parentElement
    if (!el || !floor) return
    const sync = () => {
      floor.style.setProperty('--hud-clearance', `${el.offsetHeight}px`)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [goal, namedMat, activeCraftRecipe])

  useEffect(() => {
    const oreDelta = state.stats.oreMined - prevOre.current
    const cycleDelta = state.mineCycles - prevCycles.current
    prevOre.current = state.stats.oreMined
    prevCycles.current = state.mineCycles
    if (oreDelta <= 0 && cycleDelta <= 0) return

    const drills = Object.values(entities).filter(
      (e) => e.kind === 'drill' || e.kind === 'electricDrill',
    )
    if (!drills.length) return
    const sample = drills.slice(0, Math.min(4, drills.length))
    for (const d of sample) {
      const tile = tiles[idx(d.x, d.y)]
      spawnFloater(d.x, d.y, '+', 'ore', tile?.ore ?? undefined)
    }
  }, [state.stats.oreMined, state.mineCycles, entities, tiles, spawnFloater])

  useEffect(() => {
    if (highlight === 'beltTool') {
      setToolTab('logistics')
      setRailOpen(true)
    }
    if (
      highlight === 'ore' ||
      highlight === 'roboportTool' ||
      highlight === 'drillTool' ||
      highlight === 'chestTool' ||
      highlight === 'furnaceTool'
    ) {
      setToolTab('production')
      setRailOpen(true)
    }
    if (highlight === 'inserterTool') {
      setToolTab('logistics')
      setRailOpen(true)
    }
  }, [highlight])

  useEffect(() => {
    if (!selected) return
    const tab = tabForTool(selected)
    if (!tab) return
    lastToolByTab.current[tab] = selected
    setToolTab(tab)
  }, [selected])

  const clampCamera = useCallback((p: { x: number; y: number }) => {
    const cam = cameraRef.current
    return clampPan(p, cam.zoom, viewportSize.current, cam.width, cam.height)
  }, [])

  // Keep pan bounds in sync with viewport size and zoom
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const sync = () => {
      const rect = el.getBoundingClientRect()
      viewportSize.current = { width: rect.width, height: rect.height }
      setViewSize({ width: rect.width, height: rect.height })
      setPan((p) => clampCamera(p))
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [clampCamera, zoom, width, height])

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current)
    }
  }, [])

  const toolsForTab: ToolId[] = tutorialToolsFor(tourStep, toolTab, tabTools(toolTab))

  const selectionRect = useMemo(() => {
    if (!copyCorner || !hover || selected !== 'copy') return null
    return {
      x0: Math.min(copyCorner.x, hover.x),
      y0: Math.min(copyCorner.y, hover.y),
      x1: Math.max(copyCorner.x, hover.x),
      y1: Math.max(copyCorner.y, hover.y),
    }
  }, [copyCorner, hover, selected])

  const pastePreview = useMemo(() => {
    if (selected !== 'paste' || !blueprint?.length || !hover) return null
    return blueprint.map((p) => ({
      x: hover.x + p.dx,
      y: hover.y + p.dy,
      kind: p.kind,
      dir: p.dir,
      toggle: p.toggle,
      flip: p.flip,
    }))
  }, [selected, blueprint, hover])
  const bpGhostAt = useMemo(() => {
    const map = new Map<string, NonNullable<typeof pastePreview>[number]>()
    if (!pastePreview) return map
    for (const p of pastePreview) map.set(`${p.x},${p.y}`, p)
    return map
  }, [pastePreview])

  const cellFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const world = worldRef.current
      if (!world) return null
      const rect = world.getBoundingClientRect()
      const x = Math.floor((clientX - rect.left) / (CELL * zoom))
      const y = Math.floor((clientY - rect.top) / (CELL * zoom))
      if (x < 0 || y < 0 || x >= width || y >= height) return null
      return { x, y }
    },
    [zoom, width, height],
  )

  const paintCell = useCallback(
    (x: number, y: number) => {
      const key = `${x},${y}`
      if (gesture.current.lastCell === key) return
      gesture.current.lastCell = key
      const origin =
        selected && isEntityPlaceable(selected)
          ? placeOriginFromTap(selected, x, y)
          : { x, y }
      const beforeId = state.tiles[idx(x, y)]?.entityId
      const beforeDir = beforeId ? state.entities[beforeId]?.dir : null
      const beforeFlip = beforeId ? state.entities[beforeId]?.flip : null
      const beforeFound = Boolean(state.tiles[idx(x, y)]?.foundation)
      const preview = placeEntity(state, origin.x, origin.y)
      place(origin.x, origin.y)
      const afterId = preview.tiles[idx(x, y)]?.entityId
      const afterDir = afterId ? preview.entities[afterId]?.dir : null
      const afterFlip = afterId ? preview.entities[afterId]?.flip : null
      const afterFound = Boolean(preview.tiles[idx(x, y)]?.foundation)
      const placed = Boolean(afterId && afterId !== beforeId)
      const removed = Boolean(beforeId && !afterId)
      const paved = !beforeFound && afterFound
      const unpaved = beforeFound && !afterFound
      const rotated = Boolean(
        beforeId && afterId && beforeId === afterId && beforeDir !== afterDir,
      )
      const flipped = Boolean(
        beforeId && afterId && beforeId === afterId && beforeFlip !== afterFlip,
      )

      if (selected === 'remove') {
        const beforeEnt = beforeId ? state.entities[beforeId] : null
        const afterEnt = afterId ? preview.entities[afterId] : null
        if (beforeEnt && afterEnt && beforeEnt.id === afterEnt.id) {
          const nowMarked = Boolean(afterEnt.marked)
          const wasMarked = Boolean(beforeEnt.marked)
          if (nowMarked !== wasMarked) {
            buzz(6)
            const label =
              beforeEnt.kind === 'tree'
                ? nowMarked
                  ? 'cut'
                  : 'keep'
                : beforeEnt.kind === 'rock'
                  ? nowMarked
                    ? 'dig'
                    : 'keep'
                  : nowMarked
                    ? 'scrap'
                    : 'keep'
            spawnFloater(x, y, label, nowMarked ? 'place' : 'warn')
            return
          }
        }
        if (removed || unpaved) {
          setFlash(key)
          window.setTimeout(() => setFlash((f) => (f === key ? null : f)), 180)
          buzz(8)
          spawnFloater(x, y, unpaved && !removed ? 'unpave' : 'scrap', 'warn')
        } else {
          buzz(4)
          spawnFloater(x, y, 'empty', 'warn')
        }
        return
      }

      if (selected === 'rotate') {
        if (rotated) {
          setFlash(key)
          window.setTimeout(() => setFlash((f) => (f === key ? null : f)), 180)
          buzz(8)
          spawnFloater(x, y, 'turn', 'place')
        } else {
          buzz(4)
        }
        return
      }

      if (selected === 'flip') {
        if (flipped || rotated) {
          setFlash(key)
          window.setTimeout(() => setFlash((f) => (f === key ? null : f)), 180)
          buzz(8)
          spawnFloater(x, y, 'flip', 'place')
        } else {
          buzz(4)
        }
        return
      }

      if (selected && !isEditMetaTool(selected)) {
        if (placed || paved) {
          setFlash(key)
          window.setTimeout(() => setFlash((f) => (f === key ? null : f)), 180)
          buzz(8)
          spawnFloater(x, y, PLACEABLE_META[selected].label.split(' ')[0], 'place')
        } else {
          buzz(4)
          spawnFloater(x, y, placeFailReason(state, selected, x, y) ?? 'blocked', 'warn')
        }
        return
      }

      // copy / paste / other meta - still flash on any entity change
      if (placed || removed || rotated || flipped || preview.blueprint !== state.blueprint) {
        setFlash(key)
        window.setTimeout(() => setFlash((f) => (f === key ? null : f)), 180)
        buzz(8)
      }
    },
    [place, selected, spawnFloater, state],
  )

  const centerOn = useCallback(
    (gx: number, gy: number) => {
      const vp = viewportRef.current
      if (!vp) return
      const rect = vp.getBoundingClientRect()
      viewportSize.current = { width: rect.width, height: rect.height }
      const z = cameraRef.current.zoom
      setPan(
        clampCamera({
          x: rect.width / 2 - (gx + 0.5) * CELL * z,
          y: rect.height / 2 - (gy + 0.5) * CELL * z,
        }),
      )
    },
    [clampCamera],
  )

  const nextGhost = planGhosts.find((g) => g.next) ?? planGhosts[0] ?? null
  const focusX = nextGhost?.x
  const focusY = nextGhost?.y
  useEffect(() => {
    if (tourStep?.mode !== 'coach' || tourStep.tab !== 'factory') return
    if (focusX == null || focusY == null) return
    centerOn(focusX, focusY)
  }, [tourStep?.id, tourStep?.mode, tourStep?.tab, focusX, focusY, centerOn])

  const recenter = useCallback(() => {
    const drills = Object.values(entities).filter(
      (e) => e.kind === 'drill' || e.kind === 'electricDrill',
    )
    if (drills.length) {
      const ax = drills.reduce((s, d) => s + d.x, 0) / drills.length
      const ay = drills.reduce((s, d) => s + d.y, 0) / drills.length
      centerOn(ax, ay)
      return
    }
    centerOn(
      STARTER_PAD.x + (STARTER_PAD.w - 1) / 2,
      STARTER_PAD.y + (STARTER_PAD.h - 1) / 2,
    )
  }, [entities, centerOn])

  /** Zoom around a viewport-local focal point, adjusting pan so that point stays put. */
  const zoomAt = useCallback(
    (nextZoom: number, focal: { x: number; y: number }) => {
      const z0 = cameraRef.current.zoom
      const z1 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(nextZoom * 100) / 100))
      if (z1 === z0) return
      cameraRef.current = { ...cameraRef.current, zoom: z1 }
      setPan((p) =>
        clampCamera({
          x: focal.x - ((focal.x - p.x) * z1) / z0,
          y: focal.y - ((focal.y - p.y) * z1) / z0,
        }),
      )
      setZoom(z1)
    },
    [clampCamera],
  )

  const zoomByButton = useCallback(
    (delta: number) => {
      const vp = viewportRef.current
      const size = vp
        ? { width: vp.clientWidth, height: vp.clientHeight }
        : viewportSize.current
      zoomAt(cameraRef.current.zoom + delta, {
        x: size.width / 2,
        y: size.height / 2,
      })
    },
    [zoomAt],
  )

  const clearHoldTimer = () => {
    if (holdTimer.current) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = 0
    }
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    const vp = viewportRef.current
    if (!vp) return
    clearHoldTimer()
    vp.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2) {
      const pts = [...pointers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const rect = vp.getBoundingClientRect()
      const mid = {
        x: (pts[0].x + pts[1].x) / 2 - rect.left,
        y: (pts[0].y + pts[1].y) / 2 - rect.top,
      }
      gesture.current = {
        kind: 'pinch',
        startZoom: cameraRef.current.zoom,
        startDist: Math.max(1, dist),
        startPan: { ...panRef.current },
        startMid: mid,
        moved: false,
        lastCell: null,
        origin: null,
        last: { x: e.clientX, y: e.clientY },
        pointerId: e.pointerId,
      }
      return
    }

    const cell = cellFromPoint(e.clientX, e.clientY)
    if (cell) setHover(cell)

    // Don't place yet - wait for tap vs drag. Drag always pans the map.
    gesture.current = {
      kind: 'pending',
      startZoom: zoom,
      startDist: 0,
      startPan: null,
      startMid: null,
      moved: false,
      lastCell: null,
      origin: { x: e.clientX, y: e.clientY },
      last: { x: e.clientX, y: e.clientY },
      pointerId: e.pointerId,
    }

    // Painting a line is opt-in via the Drag:Build toggle - otherwise a drag
    // always pans so you can scroll the map freely with a tool selected.
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (gesture.current.kind === 'pinch' && pointers.current.size >= 2) {
      const vp = viewportRef.current
      const startPan = gesture.current.startPan
      const startMid = gesture.current.startMid
      if (!vp || !startPan || !startMid) return

      const pts = [...pointers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      const nextZoom = Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, gesture.current.startZoom * (dist / gesture.current.startDist)),
      )
      const z1 = Math.round(nextZoom * 100) / 100
      const z0 = gesture.current.startZoom
      const rect = vp.getBoundingClientRect()
      // Keep the world point under the moving pinch midpoint stable.
      const mid = {
        x: (pts[0].x + pts[1].x) / 2 - rect.left,
        y: (pts[0].y + pts[1].y) / 2 - rect.top,
      }
      const ratio = z1 / z0
      cameraRef.current = { ...cameraRef.current, zoom: z1 }
      setZoom(z1)
      setPan(
        clampCamera({
          x: mid.x - (startMid.x - startPan.x) * ratio,
          y: mid.y - (startMid.y - startPan.y) * ratio,
        }),
      )
      gesture.current.moved = true
      return
    }

    const last = gesture.current.last ?? { x: e.clientX, y: e.clientY }
    const dx = e.clientX - last.x
    const dy = e.clientY - last.y
    gesture.current.last = { x: e.clientX, y: e.clientY }

    // Resolve pending → pan (default) or paint (only when Drag:Build is on)
    if (gesture.current.kind === 'pending' && gesture.current.origin) {
      const ox = e.clientX - gesture.current.origin.x
      const oy = e.clientY - gesture.current.origin.y
      if (Math.hypot(ox, oy) > PAN_SLOP) {
        clearHoldTimer()
        if (dragBuild && isDragPaintTool(selected)) {
          gesture.current.kind = 'paint'
          setPaintActive(true)
          const oc = cellFromPoint(gesture.current.origin.x, gesture.current.origin.y)
          if (oc) paintCell(oc.x, oc.y)
        } else {
          gesture.current.kind = 'pan'
        }
        gesture.current.moved = true
      }
    }

    if (gesture.current.kind === 'pan' && pointers.current.size === 1) {
      setPan((p) => {
        const attempted = { x: p.x + dx, y: p.y + dy }
        const next = clampCamera(attempted)
        return next
      })
      gesture.current.moved = true
      return
    }

    if (gesture.current.kind === 'paint') {
      const cell = cellFromPoint(e.clientX, e.clientY)
      if (!cell) return
      setHover(cell)
      gesture.current.moved = true
      paintCell(cell.x, cell.y)
    }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const kind = gesture.current.kind
    const origin = gesture.current.origin
    clearHoldTimer()
    pointers.current.delete(e.pointerId)

    if (pointers.current.size < 2 && kind === 'pinch') {
      gesture.current.kind = 'none'
      gesture.current.startPan = null
      gesture.current.startMid = null
      gesture.current.startZoom = 1
      gesture.current.startDist = 0
    }

    if (pointers.current.size === 0) {
      if (kind === 'pan' || kind === 'pinch') setHover(null)

      // Tap (no drag / no long-press paint): place with tool, or inspect in hand mode
      const wasTap =
        kind === 'pending' &&
        origin &&
        Math.hypot(e.clientX - origin.x, e.clientY - origin.y) <= PAN_SLOP

      if (wasTap) {
        const cell = cellFromPoint(e.clientX, e.clientY)
        if (selected && cell) {
          paintCell(cell.x, cell.y)
        } else if (!selected && cell) {
          // Tap same tile again to close; otherwise inspect (map stays pannable).
          if (inspect && inspect.x === cell.x && inspect.y === cell.y) {
            closeInspect()
          } else {
            openInspect(cell)
            buzz(6)
            const tile = tiles[idx(cell.x, cell.y)]
            if (tile?.ore) {
              spawnFloater(cell.x, cell.y, '', 'ore', tile.ore)
            }
          }
        } else if (!selected) {
          closeInspect()
        }
      }

      setPaintActive(false)
      gesture.current.kind = 'none'
      gesture.current.moved = false
      gesture.current.lastCell = null
      gesture.current.origin = null
      gesture.current.last = null
      gesture.current.pointerId = null
      gesture.current.startPan = null
      gesture.current.startMid = null
      gesture.current.startZoom = 1
      gesture.current.startDist = 0
    }
  }

  useEffect(() => {
    if (selected) setRailOpen(true)
  }, [selected])

  const selectedToolName = !selected
    ? null
    : selected === 'remove'
      ? 'Demolish'
      : selected === 'rotate'
        ? 'Rotate'
        : selected === 'flip'
          ? 'Flip'
          : selected === 'copy'
            ? 'Copy'
            : selected === 'paste'
              ? 'Paste'
              : PLACEABLE_META[selected].label

  const selectedToolCount =
    selected && !isEditMetaTool(selected)
      ? (state.inventory[PLACEABLE_META[selected].inventoryKey] ?? 0)
      : selected === 'paste' && state.blueprint
        ? state.blueprint.length
        : null

  const toolLabel =
    tourStep && selected && !isEditMetaTool(selected)
      ? `Tap the glowing tile to place ${selectedToolName}`
      : !selected
      ? 'Drag to pan · tap a tile to inspect · tap again to close'
      : selected === 'remove'
        ? dragBuild
          ? 'Drag to demolish a path · tap to demolish one'
          : 'Tap to demolish · drag pans'
        : selected === 'rotate'
          ? dragBuild
            ? 'Drag to rotate a path · tap to rotate one'
            : 'Tap to rotate · drag pans'
          : selected === 'flip'
            ? dragBuild
              ? 'Drag to flip a path · tap to flip one'
              : 'Tap to flip · drag pans'
            : selected === 'copy'
            ? 'Tap two corners · drag to pan'
            : selected === 'paste'
              ? 'Tap origin · drag to pan'
              : isDragPaintTool(selected)
                ? dragBuild
                  ? 'Drag to lay a line · tap to place one'
                  : 'Tap to place · drag pans freely'
                : 'Tap to place · drag pans'

  const modeHint = paintActive
    ? selected === 'remove'
      ? 'Release to stop demolishing'
      : selected === 'rotate'
        ? 'Release to stop rotating'
        : 'Release to stop painting'
    : tourStep && selected && !isEditMetaTool(selected)
      ? PLACEABLE_META[selected].hint
      : selected === 'remove'
      ? 'Hold-drag clears a path'
      : selected === 'rotate'
        ? 'Or use the yellow arrow FAB'
        : selected === 'flip'
          ? 'Drills swap dump square; others turn 180'
          : selected === 'drill' || selected === 'electricDrill'
            ? 'Rotate turns; Flip picks the dump square'
          : selected === 'copy'
          ? 'Second tap finishes the box'
          : selected === 'paste'
            ? state.blueprint
              ? `Blueprint ${state.blueprint.length} tiles`
              : 'Copy a region first'
            : isDragPaintTool(selected)
              ? 'Hold-drag paints a line'
              : 'Drag pans the map'

  const activeMachines = useMemo(() => {
    if (!active) return 0
    let n = 0
    for (const e of Object.values(entities)) {
      if (e.kind === 'drill' && (e.store.coal ?? 0) > 0) n++
      else if (e.kind === 'electricDrill') n++
      else if ((isFurnaceKind(e.kind) || e.kind === 'assembler') && e.smelting) n++
    }
    return n
  }, [entities, active])

  const rateLine =
    rates.ore > 0.05
      ? `${rates.ore.toFixed(1)} ore/s`
      : rates.moved > 0.05
        ? `${rates.moved.toFixed(1)} flow/s`
        : activeMachines > 0
          ? `${activeMachines} running`
          : 'idle'

  /** Green IO marks: pickup (behind) / drop (front) for every inserter + place ghost. */
  const inserterIo = useMemo(() => {
    if (!active) return EMPTY_IO
    const pickup = new Set<string>()
    const drop = new Set<string>()
    const mark = (
      set: Set<string>,
      cell: { x: number; y: number } | null,
    ) => {
      if (cell) set.add(`${cell.x},${cell.y}`)
    }

    for (const e of Object.values(entities)) {
      if (!isInserterKind(e.kind)) continue
      const reach = e.kind === 'longInserter' ? 2 : 1
      const io = inserterIoAt(e.x, e.y, e.dir, reach, width, height)
      mark(pickup, io.pickup)
      mark(drop, io.drop)
    }

    for (const e of Object.values(entities)) {
      if (e.ghost || !isDrillKind(e.kind)) continue
      for (const cell of drillOutputCells(e.kind, e.x, e.y, e.dir, e.flip === true)) {
        mark(drop, cell)
      }
    }

    if (hover && (selected === 'drill' || selected === 'electricDrill')) {
      for (const cell of drillOutputCells(selected, hover.x, hover.y, hoverDir, placeFlip)) {
        mark(drop, cell)
      }
    }

    if (
      hover &&
      (selected === 'inserter' || selected === 'longInserter')
    ) {
      const reach = selected === 'longInserter' ? 2 : 1
      const io = inserterIoAt(hover.x, hover.y, hoverDir, reach, width, height)
      mark(pickup, io.pickup)
      mark(drop, io.drop)
    }

    return { pickup, drop }
  }, [entities, width, height, hover, selected, hoverDir, placeFlip, active])

  const beltBends = useMemo(() => {
    if (!active) return EMPTY_BENDS
    const map = new Map<string, ReturnType<typeof getBeltBend>>()
    for (const e of Object.values(entities)) {
      if (!isBeltKind(e.kind)) continue
      map.set(e.id, getBeltBend(tiles, entities, e, width, height))
    }
    return map
  }, [entities, tiles, width, height, active])

  const vis = useMemo(
    () => visibleCellRange(pan, zoom, viewSize, width, height),
    [pan, zoom, viewSize, width, height],
  )

  return (
    <section className="factory-floor is-playable">
      <div className="game-hud" ref={hudRef}>
        <div className="game-hud-top">
          <div className="game-hud-identity">
            <div className="game-hud-title-row">
              <strong className="game-hud-brand">{APP_NAME}</strong>
              <span className="game-hud-lv">Lv{state.level}</span>
            </div>
            <div className="game-hud-xp" aria-hidden>
              <div className="game-hud-xp-fill" style={{ width: `${xpPct}%` }} />
            </div>
          </div>
          <div className="game-hud-rates is-inline">
            <span className={rates.ore > 0.05 ? 'is-hot' : ''}>{rateLine}</span>
          </div>
          <button
            type="button"
            className={`game-hud-steps ${stepPulse ? 'is-pulse' : ''}`}
            onClick={onOpenSteps}
            title="Today's steps - open Steps"
            aria-label={`${formatNum(state.stepsToday)} steps today`}
          >
            <span className="game-hud-steps-label">Today</span>
            <span className="game-hud-steps-num">{formatNum(state.stepsToday)}</span>
          </button>
          <button
            type="button"
            className="game-hud-settings"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
          >
            ···
          </button>
        </div>

        <div className="game-hud-resources" aria-label="Materials">
          <span
            className="game-hud-wh-label"
            title="Pack holds one stack of each material. Chests hold extra. Tap an icon for the name."
          >
            {namedMat ? ITEM_META[namedMat].label : 'Mats'}
          </span>
          {HUD_RESOURCES.map((id) => {
            const n = warehouseHudAmount(state, id)
            const label = ITEM_META[id].label
            return (
              <button
                key={id}
                type="button"
                className={`game-res${resPulse[id] ? ' is-pulse' : ''}${n <= 0 ? ' is-zero' : ''}${
                  namedMat === id ? ' is-named' : ''
                }`}
                style={{ '--res': ITEM_META[id].color } as CSSProperties}
                title={`${label}: pack holds up to 100, chests hold more`}
                aria-label={`${label} ${formatNum(n)}`}
                onClick={() => setNamedMat(id)}
              >
                <ItemSprite item={id} />
                <span className="game-res-name">{label}</span>
                <em className="game-res-count">{formatNum(n)}</em>
              </button>
            )
          })}
        </div>

        <div
          className={`game-hud-power ${powerLevel}`}
          title={`Power ${powerStored}/${powerCap} · +${powerStep}/step from ${genCount} generator${
            genCount === 1 ? '' : 's'
          } · using ${powerUse.toFixed(1)}/s`}
        >
          <span className="game-hud-power-icon" aria-hidden>
            <ItemSprite item="generator" />
          </span>
          <div className="game-hud-power-bar" aria-hidden>
            <div
              className="game-hud-power-fill"
              style={{ width: `${Math.round(powerFrac * 100)}%` }}
            />
          </div>
          <span className="game-hud-power-text">
            {powerStored}/{formatNum(powerCap)}
            <em>
              {powerFrac <= 0 ? 'walk to charge' : `+${powerStep}/step · -${powerUse.toFixed(1)}/s`}
            </em>
          </span>
        </div>

        {goal ? (
          <button
            type="button"
            className={`game-objective${claimableContracts.length > 0 ? ' is-claim' : ''}`}
            onClick={onOpenTasks}
          >
            <span>{claimableContracts.length > 0 ? 'Claim' : 'Objective'}</span>
            <strong>
              {claimableContracts.length > 0
                ? `${goal.title} · ${claimableContracts.length} ready`
                : goal.title}
            </strong>
            {goalProg && (
              <em className="game-objective-prog">
                {goalProg.cur.toLocaleString()}/{goalProg.max.toLocaleString()}
              </em>
            )}
            {goalProg && (
              <span
                className="game-objective-bar"
                aria-hidden
                style={
                  {
                    '--obj-pct': `${Math.min(100, (goalProg.cur / goalProg.max) * 100)}%`,
                  } as CSSProperties
                }
              />
            )}
          </button>
        ) : claimableContracts.length > 0 ? (
          <button
            type="button"
            className="game-objective is-claim"
            onClick={onOpenTasks}
          >
            <span>Contracts</span>
            <strong>
              {claimableContracts.length === 1
                ? 'Claim ready'
                : `${claimableContracts.length} claims ready`}
            </strong>
          </button>
        ) : (
          <button type="button" className="game-objective is-clear" onClick={onOpenTasks}>
            <span>Contracts</span>
            <strong>All clear - expand</strong>
          </button>
        )}

        {activeCraftRecipe && (
          <div className="game-craft-chip" aria-live="polite">
            <span className="game-craft-chip-label">Crafting</span>
            <strong>{activeCraftRecipe.name}</strong>
            <em>
              {state.craftQueue.length > 1
                ? `+${state.craftQueue.length - 1} queued`
                : `${Math.round(craftPct)}%`}
            </em>
            <span
              className="game-craft-chip-bar"
              aria-hidden
              style={{ '--craft-pct': `${craftPct}%` } as CSSProperties}
            />
          </div>
        )}
      </div>

      <div
        className={[
          'factory-viewport',
          'is-pan',
          selected ? 'is-build' : '',
          railOpen && selected ? 'is-tools-open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className="factory-world"
          ref={worldRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            width: width * CELL,
            height: height * CELL,
          }}
        >
          {active && (
            <>
          <div
            className="factory-grid"
            style={{
              width: width * CELL,
              height: height * CELL,
            }}
          >
            {Array.from({ length: vis.y1 - vis.y0 + 1 }, (_, iy) => {
              const y = vis.y0 + iy
              return Array.from({ length: vis.x1 - vis.x0 + 1 }, (_, ix) => {
                const x = vis.x0 + ix
                const tile = tiles[idx(x, y)]
                if (!tile) return null
                const ent = tile.entityId ? entities[tile.entityId] ?? null : null
                const key = `${x},${y}`
                const showGhost =
                  !!placeOrigin &&
                  placeOrigin.x === x &&
                  placeOrigin.y === y &&
                  !!selected &&
                  !isEditMetaTool(selected)
                return (
                  <FloorCell
                    key={`${x}-${y}`}
                    x={x}
                    y={y}
                    tile={tile}
                    ent={ent}
                    state={state}
                    floorNet={floorNet}
                    inserterCd={inserterCd}
                    hasBattery={hasBattery}
                    portBusy={Boolean(ent?.kind === 'roboport' && busyPorts.has(ent.id))}
                    beltBend={
                      ent && isBeltKind(ent.kind) ? beltBends.get(ent.id) ?? null : null
                    }
                    isHover={hover?.x === x && hover?.y === y}
                    inHoverFoot={Boolean(hoverFootprint?.keys.has(key))}
                    hoverFootOk={Boolean(hoverFootprint?.valid)}
                    inSelect={Boolean(
                      selectionRect &&
                        x >= selectionRect.x0 &&
                        x <= selectionRect.x1 &&
                        y >= selectionRect.y0 &&
                        y <= selectionRect.y1,
                    )}
                    isCopyCorner={
                      copyCorner?.x === x && copyCorner?.y === y && selected === 'copy'
                    }
                    isInspect={inspect?.x === x && inspect?.y === y}
                    isFlash={flash === key}
                    isIoPickup={inserterIo.pickup.has(key)}
                    isIoDrop={inserterIo.drop.has(key)}
                    highlightOre={highlight === 'ore'}
                    showGhost={showGhost}
                    ghostValid={Boolean(showGhost && hoverFootprint?.valid)}
                    ghostKind={showGhost ? selected : null}
                    ghostDir={hoverDir}
                    ghostFlip={placeFlip}
                    planGhost={ghostAt.get(key) ?? null}
                    bpGhost={bpGhostAt.get(key) ?? null}
                  />
                )
              })
            })}
          </div>

          {floaters.map((f) => (
            <span
              key={f.id}
              className={`world-floater tone-${f.tone}${f.item ? ' has-icon' : ''}`}
              style={{
                left: f.x * CELL + CELL * 0.2,
                top: f.y * CELL + CELL * 0.15,
              }}
            >
              {f.text}
              {f.item && (
                <span className="floater-icon">
                  <ItemSprite item={f.item} />
                </span>
              )}
            </span>
          ))}

          {state.drones.map((d) => (
            <span
              key={d.id}
              className={`construction-drone is-${d.state}`}
              style={{
                left: (d.x + 0.5) * CELL,
                top: (d.y + 0.5) * CELL,
              }}
              aria-hidden
            >
              <DroneSprite />
            </span>
          ))}
            </>
          )}
        </div>

        <div className="viewport-fabs">
          <button
            type="button"
            className="fab-btn"
            onClick={() => zoomByButton(-0.15)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="fab-btn"
            onClick={() => zoomByButton(0.15)}
            aria-label="Zoom in"
          >
            +
          </button>
          {needsPlaceDir(selected) && (
            <button
              type="button"
              className="fab-btn fab-rotate"
              onClick={() => {
                rotateDir()
                buzz(6)
              }}
              aria-label="Rotate placement"
              title={`Facing ${placeDir}`}
            >
              {dirArrow(placeDir)}
            </button>
          )}
          {(selected === 'drill' || selected === 'electricDrill') && (
            <button
              type="button"
              className={`fab-btn fab-flip${placeFlip ? ' is-on' : ''}`}
              onClick={() => {
                flipDir()
                buzz(6)
              }}
              aria-label="Flip output square"
              title={
                placeFlip
                  ? 'Dump: other facing square'
                  : 'Dump: primary facing square'
              }
            >
              {placeDir === 'N' || placeDir === 'S' ? '↔' : '↕'}
            </button>
          )}
          <button type="button" className="fab-btn" onClick={recenter} aria-label="Recenter">
            ⌖
          </button>
        </div>

        {active && (
          <Minimap
            width={width}
            height={height}
            tiles={tiles}
            entities={entities}
            pan={pan}
            zoom={zoom}
            viewportRef={viewportRef}
            onJump={centerOn}
          />
        )}

        {(selected || paintActive) && (
          <div
            className={`mode-banner${paintActive ? ' is-painting' : ''}`}
            aria-live="polite"
          >
            <strong>{paintActive ? 'Painting - drag to continue' : toolLabel}</strong>
            <span>{modeHint}</span>
          </div>
        )}

        <div
          className={`build-rail ${railOpen && selected ? 'is-expanded' : 'is-slim'}`}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          {selected && selectedToolName && (
            <div className="build-rail-selected" aria-live="polite">
              <ToolIcon kind={selected} />
              <strong>{selectedToolName}</strong>
              {selectedToolCount != null && (
                <span className="build-rail-selected-count">
                  {selected === 'paste' ? `${formatNum(selectedToolCount)} tiles` : formatNum(selectedToolCount)}
                </span>
              )}
            </div>
          )}
          {railOpen && selected && (
            <div
              className="build-rail-tray"
              role="toolbar"
              aria-label={
                toolTab === 'production'
                  ? 'Production tools'
                  : toolTab === 'logistics'
                    ? 'Logistics tools'
                    : toolTab === 'floor'
                      ? 'Floor tools'
                      : 'Edit tools'
              }
            >
              <div className="build-rail-tools">
                {toolsForTab.map((tool) => {
                  const unlocked = isUnlocked(tool, state.researched)
                  const label =
                    tool === 'remove'
                      ? 'Demolish'
                      : tool === 'rotate'
                        ? 'Rotate'
                        : tool === 'flip'
                          ? 'Flip'
                          : tool === 'copy'
                            ? 'Copy'
                            : tool === 'paste'
                              ? 'Paste'
                              : PLACEABLE_META[tool].label
                  const count = isEditMetaTool(tool)
                    ? tool === 'paste' && state.blueprint
                      ? state.blueprint.length
                      : null
                    : state.inventory[PLACEABLE_META[tool].inventoryKey]
                  const pulse =
                    (highlight === 'roboportTool' && tool === 'roboport') ||
                    (highlight === 'drillTool' && tool === 'drill') ||
                    (highlight === 'ore' && tool === 'drill') ||
                    (highlight === 'beltTool' && tool === 'belt') ||
                    (highlight === 'inserterTool' &&
                      (tool === 'inserter' || tool === 'longInserter')) ||
                    (highlight === 'chestTool' && tool === 'chest') ||
                    (highlight === 'furnaceTool' &&
                      (tool === 'furnace' || tool === 'steelFurnace'))
                  const affordable =
                    isEditMetaTool(tool) || (count !== null && count > 0)
                  return (
                    <button
                      key={tool}
                      type="button"
                      disabled={!unlocked}
                      className={[
                        'rail-tool',
                        selected === tool ? 'is-active' : '',
                        !unlocked ? 'is-locked' : '',
                        unlocked && !affordable ? 'is-empty' : '',
                        pulse ? 'is-tutorial-pulse' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        if (!unlocked) return
                        selectTool(tool)
                        setInspect(null)
                        buzz(6)
                      }}
                      title={unlocked ? label : `${label} - research to unlock`}
                      aria-label={
                        count !== null ? `${label}, ${formatNum(count)}` : label
                      }
                    >
                      <span className="rail-tool-icon">
                        <ToolIcon kind={tool} />
                      </span>
                      <span className="rail-tool-name">{label}</span>
                      {count !== null && (
                        <span className="rail-tool-count">{formatNum(count)}</span>
                      )}
                      {!unlocked && (
                        <span className="rail-tool-lock" aria-hidden>
                          🔒
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <div className="build-rail-quick">
                {selected && isDragPaintTool(selected) && (
                  <button
                    type="button"
                    className={`rail-chip ${dragBuild ? 'is-on' : ''}`}
                    onClick={() => {
                      setDragBuild((v) => !v)
                      buzz(6)
                    }}
                    title={
                      dragBuild
                        ? 'Drag lays a line of buildings'
                        : 'Drag pans the map (tap to place)'
                    }
                  >
                    {dragBuild ? 'Drag: Build' : 'Drag: Pan'}
                  </button>
                )}
                <button
                  type="button"
                  className="rail-chip"
                  onClick={() => {
                    const preview = fuelAllDrills(state)
                    let fueled = 0
                    for (const e of Object.values(state.entities)) {
                      if (!isFurnaceKind(e.kind)) continue
                      const before = (e.store.coal ?? 0) + (e.store.wood ?? 0)
                      const p = preview.entities[e.id]?.store
                      const after = (p?.coal ?? 0) + (p?.wood ?? 0)
                      if (after > before + 0.01) {
                        spawnFloater(e.x, e.y, '+fuel', 'good')
                        fueled += 1
                      }
                    }
                    fuelDrills()
                    if (fueled <= 0) {
                      const anyFurnace = Object.values(state.entities).find((e) =>
                        isFurnaceKind(e.kind),
                      )
                      if (anyFurnace) spawnFloater(anyFurnace.x, anyFurnace.y, 'no fuel', 'warn')
                      buzz(4)
                    } else {
                      buzz(10)
                    }
                  }}
                >
                  Fuel
                </button>
              </div>
            </div>
          )}

          <div className="build-rail-modes" role="tablist" aria-label="Tool groups">
            <button
              type="button"
              className={`rail-mode ${!selected ? 'is-active' : ''}`}
              onClick={() => {
                selectTool(null)
                setRailOpen(false)
                setInspect(null)
              }}
              title="Hand - pan the map"
            >
              Hand
            </button>
            {TOOL_TABS.map(({ id, label, title }) => {
              const list = tabTools(id)
              const tabActive = !!selected && list.includes(selected)
              return (
                <button
                  key={id}
                  type="button"
                  className={`rail-mode ${tabActive ? 'is-active' : ''}`}
                  title={title}
                  aria-label={title}
                  onClick={() => {
                    setToolTab(id)
                    const remembered = lastToolByTab.current[id]
                    const next =
                      remembered && list.includes(remembered)
                        ? remembered
                        : selected && list.includes(selected)
                          ? selected
                          : pickTool(list)
                    if (next) {
                      lastToolByTab.current[id] = next
                      selectTool(next)
                      setRailOpen(true)
                      setInspect(null)
                    }
                  }}
                >
                  {label}
                </button>
              )
            })}
            <button
              type="button"
              className="rail-mode is-toggle"
              onClick={() => {
                if (railOpen && selected) {
                  setRailOpen(false)
                } else {
                  const next = selected ?? pickTool(tabTools(toolTab))
                  if (next) selectTool(next)
                  setRailOpen(true)
                }
              }}
              aria-expanded={railOpen && !!selected}
              title={railOpen && selected ? 'Hide tools' : 'Show tools'}
            >
              {railOpen && selected ? '▾' : '▴'}
            </button>
          </div>
        </div>

      {inspect && inspectTile && (
        <div className="inspect-modal" role="presentation">
          <div
            className={`inspect-card ${inspectEnt ? 'is-entity' : 'is-ground'}`}
            role="dialog"
            aria-label={inspectEnt ? 'Machine' : 'Tile'}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onPointerCancel={(e) => e.stopPropagation()}
          >
            <div className="inspect-card-head">
              <div className="inspect-card-title">
                {inspectEnt ? (
                  <>
                    <ToolIcon kind={inspectEnt.kind as Placeable} />
                    <strong>
                      {inspectEnt.kind === 'tree'
                        ? treeVariant(inspectEnt.variant).label
                        : inspectEnt.kind === 'rock'
                          ? rockVariant(inspectEnt.variant).label
                          : (PLACEABLE_META[inspectEnt.kind as Placeable]?.label ?? inspectEnt.kind)}
                    </strong>
                    <span className="inspect-card-dir" aria-hidden>
                      {dirArrow(inspectEnt.dir)}
                    </span>
                  </>
                ) : inspectTile.foundation ? (
                  <>
                    <ToolIcon kind="foundation" />
                    <strong>Foundation</strong>
                  </>
                ) : inspectTile.ore ? (
                  <>
                    <ItemSprite item={inspectTile.ore} />
                    <strong>{ITEM_META[inspectTile.ore].label}</strong>
                  </>
                ) : (
                  <strong>Empty ground</strong>
                )}
              </div>
              <div className="inspect-card-head-actions">
                {inspectEnt &&
                  inspectEnt.kind !== 'tree' &&
                  inspectEnt.kind !== 'rock' && (
                    <>
                      <button
                        type="button"
                        className="inspect-card-tool"
                        onClick={() => {
                          rotateAt(inspect.x, inspect.y)
                          buzz(8)
                        }}
                        aria-label="Rotate"
                        title="Rotate"
                      >
                        Turn
                      </button>
                      <button
                        type="button"
                        className="inspect-card-tool"
                        onClick={() => {
                          flipAt(inspect.x, inspect.y)
                          buzz(8)
                        }}
                        aria-label="Flip"
                        title={
                          isDrillKind(inspectEnt.kind)
                            ? 'Swap dump square'
                            : 'Turn 180'
                        }
                      >
                        Flip
                      </button>
                    </>
                  )}
                <button
                  type="button"
                  className="inspect-card-close"
                  onClick={() => closeInspect()}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>

            {inspectEnt ? (
              <>
                <p className="inspect-card-desc">
                  {inspectEnt.kind === 'tree'
                    ? (() => {
                        const def = treeVariant(inspectEnt.variant)
                        return `${def.label} takes ${def.cutSeconds}s to chop and yields ${def.wood} wood.`
                      })()
                    : inspectEnt.kind === 'rock'
                      ? (() => {
                          const def = rockVariant(inspectEnt.variant)
                          const loot = def.drops
                            .filter((d) => d.chance == null)
                            .map((d) => `${d.amount} ${ITEM_META[d.item].label.toLowerCase()}`)
                            .join(', ')
                          return `${def.label} takes ${def.mineSeconds}s to excavate. Drops ${loot}.`
                        })()
                      : (PLACEABLE_META[inspectEnt.kind as Placeable]?.hint ??
                        (inspectEnt.kind === 'assembler'
                          ? 'Crafts gears from iron plates.'
                          : 'Use Turn or Flip in the header; Demolish to remove.'))}
                </p>
                {(() => {
                  const status = machineStatus(inspectEnt, inspectTile, state, floorNet)
                  return (
                    <p className={`inspect-card-status is-${status.tone}`}>
                      {status.label}
                    </p>
                  )
                })()}
                {hasMachineInventory(inspectEnt.kind) && (
                  <MachineInventory entity={inspectEnt} />
                )}
                <p className="inspect-card-meta">
                  ({inspect.x},{inspect.y})
                  {inspectTile.foundation
                    ? tileIsPoweredFloor(state, inspect.x, inspect.y, floorNet)
                      ? ' · on powered Foundation'
                      : ' · on Foundation (no generator connected)'
                    : ''}
                  {inspectTile.ore
                    ? ` · on ${ITEM_META[inspectTile.ore].label}${
                        inspectTile.amount != null
                          ? ` (${formatNum(inspectTile.amount)} left)`
                          : ''
                      }`
                    : inspectTile.foundation
                      ? ''
                      : ' · plain ground'}
                </p>
                {!hasMachineInventory(inspectEnt.kind) &&
                  storeHasItems(inspectEnt) && (
                    <div className="inspect-store">
                      <StoreTags store={inspectEnt.store} />
                    </div>
                  )}
                <div className="inspect-card-actions">
                  {isFurnaceKind(inspectEnt.kind) && (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={stockOf(state, 'coal') < 1 && stockOf(state, 'wood') < 1}
                      onClick={() => {
                        const before = stockOf(state, 'coal') + stockOf(state, 'wood')
                        const preview = fuelDrillAt(state, inspect.x, inspect.y)
                        fuelAt(inspect.x, inspect.y)
                        const spent =
                          before - (stockOf(preview, 'coal') + stockOf(preview, 'wood'))
                        if (spent <= 0) {
                          spawnFloater(inspect.x, inspect.y, 'no fuel', 'warn')
                          buzz(4)
                        } else {
                          spawnFloater(inspect.x, inspect.y, '+fuel', 'good')
                          buzz(10)
                        }
                      }}
                    >
                      Fuel
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary-btn danger-btn"
                    onClick={() => {
                      selectTool('remove')
                      place(inspect.x, inspect.y)
                      selectTool(null)
                      setInspect(null)
                      buzz(15)
                    }}
                  >
                    {inspectEnt.marked
                      ? 'Cancel scrap'
                      : inspectEnt.ghost
                        ? 'Cancel ghost'
                        : 'Demolish'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="inspect-card-desc">
                  {inspectTile.foundation
                    ? tileIsPoweredFloor(state, inspect.x, inspect.y, floorNet)
                      ? 'Foundation - powered. Inserters, assemblers, and splitters on this tile can run. Belts run anywhere.'
                      : 'Foundation - no generator connected. Place a generator on or next to this floor, or paint a path to one.'
                    : inspectTile.ore === 'ironOre'
                    ? 'Brown iron patch. Place a burner or electric drill here to mine it with steps.'
                    : inspectTile.ore === 'copperOre'
                      ? 'Copper patch. Drill here to mine copper ore for plates and wiring crafts.'
                      : inspectTile.ore === 'coal'
                        ? 'Coal seam. Mine it for fuel - burner drills and furnaces need coal.'
                        : 'Open ground. Paint Foundation here so inserters and assemblers can take power from a generator. Belts do not need Foundation.'}
                </p>
                <p className="inspect-card-meta">
                  ({inspect.x},{inspect.y})
                  {inspectTile.foundation
                    ? tileIsPoweredFloor(state, inspect.x, inspect.y, floorNet)
                      ? ' · powered Foundation'
                      : ' · Foundation (no generator)'
                    : ''}
                  {inspectTile.ore
                    ? inspectTile.amount == null
                      ? ` · ${ITEM_META[inspectTile.ore].label}`
                      : ` · ${ITEM_META[inspectTile.ore].label} (${formatNum(inspectTile.amount)} left)`
                    : inspectTile.foundation
                      ? ''
                      : ' · buildable tile'}
                </p>
                <div className="inspect-card-actions">
                  {inspectTile.ore && (
                    <>
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={(state.inventory.drill ?? 0) < 1}
                      onClick={() => {
                        selectTool('drill')
                        setRailOpen(true)
                        setToolTab('production')
                        setInspect(null)
                        buzz(6)
                      }}
                    >
                      Select drill
                    </button>
                    {(state.inventory.electricDrill ?? 0) > 0 &&
                      state.researched.includes('electricMining') && (
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={() => {
                            selectTool('electricDrill')
                            setRailOpen(true)
                            setToolTab('production')
                            setInspect(null)
                            buzz(6)
                          }}
                        >
                          Electric drill
                        </button>
                      )}
                    </>
                  )}
                  {!inspectTile.foundation && (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={(state.inventory.foundation ?? 0) < 1}
                      onClick={() => {
                        selectTool('foundation')
                        setRailOpen(true)
                        setToolTab('floor')
                        setInspect(null)
                        buzz(6)
                      }}
                    >
                      Paint floor
                    </button>
                  )}
                  {inspectTile.foundation && (
                    <button
                      type="button"
                      className="primary-btn danger-btn"
                      onClick={() => {
                        selectTool('remove')
                        place(inspect.x, inspect.y)
                        selectTool(null)
                        setInspect(null)
                        buzz(15)
                      }}
                    >
                      Demolish
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </div>
    </section>
  )
}

function paintMinimap(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tiles: GameState['tiles'],
  entities: GameState['entities'],
  theme: string,
) {
  const light = theme === 'light'
  canvas.width = width
  canvas.height = height
  const img = ctx.createImageData(width, height)
  const data = img.data
  const hex = (color: string): [number, number, number] => {
    const h = color.replace('#', '')
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]
  }
  const put = (i: number, color: string) => {
    const [r, g, b] = hex(color)
    const o = i * 4
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = 255
  }
  const grass = light ? '#9bb262' : '#3a4a28'
  const iron = light ? '#a09078' : '#8B7355'
  const copper = '#C4783A'
  const coal = light ? '#5a5a5a' : '#2A2A2A'
  const foundation = light ? '#c4bdb2' : '#8a8478'
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i]
    if (tile.ore === 'ironOre') put(i, iron)
    else if (tile.ore === 'copperOre') put(i, copper)
    else if (tile.ore === 'coal') put(i, coal)
    else if (tile.foundation && !tile.entityId) put(i, foundation)
    else put(i, grass)
  }
  ctx.putImageData(img, 0, 0)
  for (const ent of Object.values(entities)) {
    const kind = ent.kind
    if (kind.includes('belt') || kind === 'splitter') ctx.fillStyle = '#f0a020'
    else if (kind.includes('drill')) ctx.fillStyle = light ? '#3d9e5f' : '#7dff9a'
    else if (kind.includes('furnace') || kind === 'assembler') ctx.fillStyle = '#e07040'
    else if (kind === 'tree') {
      ctx.fillStyle = ent.marked ? '#e0b050' : treeVariant(ent.variant).color
    } else if (kind === 'rock') {
      ctx.fillStyle = ent.marked ? '#e0b050' : rockVariant(ent.variant).color
    } else if (kind === 'roboport') ctx.fillStyle = '#3fa7c9'
    else ctx.fillStyle = '#7b8792'
    const { w, h } = sizeOf(kind)
    ctx.fillRect(ent.x, ent.y, w, h)
  }
}

function Minimap({
  width,
  height,
  tiles,
  entities,
  pan,
  zoom,
  viewportRef,
  onJump,
}: {
  width: number
  height: number
  tiles: GameState['tiles']
  entities: GameState['entities']
  pan: { x: number; y: number }
  zoom: number
  viewportRef: RefObject<HTMLDivElement | null>
  onJump: (x: number, y: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [theme, setTheme] = useState(resolveTheme)
  const drawAt = useRef(0)

  useEffect(() => subscribeTheme(({ resolved }) => setTheme(resolved)), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const delay = Math.max(0, 800 - (performance.now() - drawAt.current))
    const timer = window.setTimeout(() => {
      if (cancelled) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      drawAt.current = performance.now()
      paintMinimap(canvas, ctx, width, height, tiles, entities, theme)
    }, delay)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [width, height, tiles, entities, theme])

  const view = useMemo(() => {
    const vp = viewportRef.current
    if (!vp) return null
    const rect = vp.getBoundingClientRect()
    const left = Math.max(0, Math.min(width, -pan.x / (CELL * zoom)))
    const top = Math.max(0, Math.min(height, -pan.y / (CELL * zoom)))
    const w = Math.min(width - left, rect.width / (CELL * zoom))
    const h = Math.min(height - top, rect.height / (CELL * zoom))
    return { left, top, w, h }
  }, [pan, zoom, width, height, viewportRef])

  return (
    <button
      type="button"
      className="minimap"
      aria-label="Minimap - tap to jump"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = ((e.clientX - rect.left) / rect.width) * width
        const y = ((e.clientY - rect.top) / rect.height) * height
        onJump(x, y)
        buzz(6)
      }}
    >
      <canvas ref={canvasRef} />
      {view && (
        <span
          className="minimap-view"
          style={{
            left: `${(view.left / width) * 100}%`,
            top: `${(view.top / height) * 100}%`,
            width: `${(view.w / width) * 100}%`,
            height: `${(view.h / height) * 100}%`,
          }}
        />
      )}
    </button>
  )
}
