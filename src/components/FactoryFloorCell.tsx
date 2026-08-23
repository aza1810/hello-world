import { memo, type CSSProperties } from 'react'
import { CELL } from '../game/camera'
import {
  ITEM_META,
  OPPOSITE,
  formatNum,
  isDrillKind,
  isEntityPlaceable,
  isFurnaceKind,
  isInserterKind,
  sizeOf,
  storeTotal,
} from '../game/data'
import type { BeltBend } from '../game/beltShape'
import { drillHasOre } from '../game/logic'
import { machineStatus, needsFloorStatus } from '../game/machineStatus'
import {
  drillHasRemotePower,
  tileIsPoweredFloor,
  type PowerNet,
} from '../game/power'
import { EntitySprite, FoundationSprite, ItemSprite, OreTexture } from '../sprites/Sprites'
import type {
  Dir,
  Entity,
  EntityKind,
  GameState,
  ItemId,
  OreId,
  Tile,
  ToolId,
} from '../game/types'

export { CELL }

function InserterDirOverlay({ dir }: { dir: Dir }) {
  return (
    <span className={`cell-inserter-dir is-${dir}`} aria-hidden>
      <svg viewBox="0 0 32 32" className="cell-inserter-dir-svg">
        <path
          d="M6 16 H20"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path d="M18 8 L28 16 L18 24 Z" fill="currentColor" stroke="#1a1612" strokeWidth="1" />
      </svg>
    </span>
  )
}

export function storeHasItems(e: Entity): boolean {
  return Object.values(e.store).some((n) => (n ?? 0) > 0)
}

export function StoreTags({ store }: { store: Entity['store'] }) {
  const parts = (Object.entries(store) as [ItemId, number][]).filter(
    ([, n]) => (n ?? 0) > 0,
  )
  if (parts.length === 0) return null
  return (
    <>
      {parts.map(([id, n]) => (
        <span className="store-tag" key={id} title={ITEM_META[id].label}>
          <span className="store-tag-icon">
            <ItemSprite item={id} />
          </span>
          <span className="store-tag-name">{ITEM_META[id].label}</span>
          <em>{formatNum(n)}</em>
        </span>
      ))}
    </>
  )
}

function cargoOffset(
  dir: Entity['dir'],
  p: number,
  opts?: { underground?: boolean; fromDir?: Dir | null },
): CSSProperties {
  const t = Math.min(1, Math.max(0, p))
  const from = opts?.fromDir
  const isCorner = !!from && from !== dir && from !== OPPOSITE[dir]

  const along = (travel: Dir, u: number) => {
    const d = -42 + u * 84
    if (travel === 'E') return { x: d, y: 0 }
    if (travel === 'W') return { x: -d, y: 0 }
    if (travel === 'S') return { x: 0, y: d }
    return { x: 0, y: -d }
  }

  let x = 0
  let y = 0
  if (isCorner && from) {
    const pos = t < 0.5 ? along(from, t) : along(dir, t)
    x = pos.x
    y = pos.y
  } else if (dir === 'E') {
    x = -42 + t * 84
    y = 0
  } else if (dir === 'W') {
    x = 42 - t * 84
    y = 0
  } else if (dir === 'S') {
    x = 0
    y = -42 + t * 84
  } else {
    x = 0
    y = 42 - t * 84
  }
  let opacity = 1
  if (opts?.underground) {
    opacity = t < 0.25 ? t / 0.25 : t > 0.75 ? (1 - t) / 0.25 : 1
  }
  return {
    transform: `translate(-50%, -50%) translate(${x}%, ${y}%)`,
    opacity,
  }
}

export type PlanGhost = { kind: EntityKind; dir: Dir; next?: boolean }
export type BpGhost = { kind: EntityKind; dir: Dir; toggle?: number; flip?: boolean }

export type FloorCellProps = {
  x: number
  y: number
  tile: Tile
  ent: Entity | null
  state: GameState
  floorNet: PowerNet
  inserterCd: number
  hasBattery: boolean
  portBusy: boolean
  beltBend: BeltBend | null
  isHover: boolean
  inHoverFoot: boolean
  hoverFootOk: boolean
  inSelect: boolean
  isCopyCorner: boolean
  isInspect: boolean
  isFlash: boolean
  isIoPickup: boolean
  isIoDrop: boolean
  highlightOre: boolean
  showGhost: boolean
  ghostValid: boolean
  ghostKind: ToolId | null
  ghostDir: Dir
  ghostFlip: boolean
  planGhost: PlanGhost | null
  bpGhost: BpGhost | null
  originX: number
  originY: number
}

function sameCell(a: FloorCellProps, b: FloorCellProps): boolean {
  return (
    a.tile === b.tile &&
    a.ent === b.ent &&
    a.floorNet === b.floorNet &&
    a.inserterCd === b.inserterCd &&
    a.hasBattery === b.hasBattery &&
    a.portBusy === b.portBusy &&
    a.beltBend === b.beltBend &&
    a.isHover === b.isHover &&
    a.inHoverFoot === b.inHoverFoot &&
    a.hoverFootOk === b.hoverFootOk &&
    a.inSelect === b.inSelect &&
    a.isCopyCorner === b.isCopyCorner &&
    a.isInspect === b.isInspect &&
    a.isFlash === b.isFlash &&
    a.isIoPickup === b.isIoPickup &&
    a.isIoDrop === b.isIoDrop &&
    a.highlightOre === b.highlightOre &&
    a.showGhost === b.showGhost &&
    a.ghostValid === b.ghostValid &&
    a.ghostKind === b.ghostKind &&
    a.ghostDir === b.ghostDir &&
    a.ghostFlip === b.ghostFlip &&
    a.planGhost === b.planGhost &&
    a.bpGhost === b.bpGhost &&
    a.originX === b.originX &&
    a.originY === b.originY
  )
}

function FloorCellInner({
  x,
  y,
  tile,
  ent,
  state,
  floorNet,
  inserterCd,
  hasBattery,
  portBusy,
  beltBend,
  isHover,
  inHoverFoot,
  hoverFootOk,
  inSelect,
  isCopyCorner,
  isInspect,
  isFlash,
  isIoPickup,
  isIoDrop,
  highlightOre,
  showGhost,
  ghostValid,
  ghostKind,
  ghostDir,
  ghostFlip,
  planGhost,
  bpGhost,
  originX,
  originY,
}: FloorCellProps) {
  const entSize = ent ? sizeOf(ent.kind) : { w: 1, h: 1 }
  const isAnchor = !ent || (ent.x === x && ent.y === y)
  const drawEnt = !!ent && isAnchor
  const entBig = entSize.w > 1 || entSize.h > 1
  const selSize = ghostKind && isEntityPlaceable(ghostKind) ? sizeOf(ghostKind) : { w: 1, h: 1 }
  const selBig = selSize.w > 1 || selSize.h > 1
  const bigStyle = (w: number, h: number): CSSProperties => ({
    left: 0,
    top: 0,
    right: 'auto',
    bottom: 'auto',
    width: w * CELL,
    height: h * CELL,
  })
  const seed = x * 13 + y * 29
  const isGhost = Boolean(ent?.ghost)
  const isMarkedTree = Boolean(ent?.marked)
  const lit = Boolean(
    ent &&
      !isGhost &&
      (isFurnaceKind(ent.kind) || ent.kind === 'assembler') &&
      ent.smelting,
  )
  const active = Boolean(
    !isGhost &&
      ((ent &&
        isDrillKind(ent.kind) &&
        drillHasOre(state, ent.x, ent.y) &&
        hasBattery &&
        drillHasRemotePower(ent, state, floorNet)) ||
        (ent?.kind === 'generator' && hasBattery) ||
        (ent?.kind === 'roboport' && portBusy)),
  )
  const status = needsFloorStatus(ent) ? machineStatus(ent!, tile, state, floorNet) : null
  const movingBelt =
    ent?.kind === 'belt' ||
    ent?.kind === 'fastBelt' ||
    ent?.kind === 'splitter' ||
    ent?.kind === 'undergroundBelt'
  const filled = ent ? storeTotal(ent.store) > 0 : false

  return (
    <div
      className={[
        'cell',
        tile.ore ? `ore-${tile.ore}` : 'ore-none',
        ent ? `has-${ent.kind}` : '',
        (drawEnt && entBig) || (showGhost && selBig) ? 'is-big' : '',
        isHover ? 'is-hover' : '',
        inSelect ? 'is-select' : '',
        isCopyCorner ? 'is-copy-corner' : '',
        bpGhost ? 'is-bp-ghost' : '',
        highlightOre && tile.ore === 'ironOre' && !ent ? 'is-ore-hint' : '',
        isGhost ? 'is-constructing' : '',
        isMarkedTree ? 'is-marked-tree' : '',
        planGhost ? 'is-plan-ghost' : '',
        planGhost?.next ? 'is-plan-next' : '',
        showGhost ? (ghostValid ? 'is-valid-ghost' : 'is-invalid-ghost') : '',
        inHoverFoot ? (hoverFootOk ? 'is-footprint-ok' : 'is-footprint-bad') : '',
        isInspect ? 'is-inspect' : '',
        isFlash ? 'is-flash' : '',
        active ? 'is-active-machine' : '',
        lit ? 'is-lit' : '',
        status?.floorClass ?? '',
        isIoPickup ? 'is-io-pickup' : '',
        isIoDrop ? 'is-io-drop' : '',
        tile.foundation ? 'has-foundation' : '',
        tile.foundation && tileIsPoweredFloor(state, x, y, floorNet)
          ? 'is-powered-floor'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: (x - originX) * CELL,
        top: (y - originY) * CELL,
        width: CELL,
        height: CELL,
      }}
    >
      {tile.ore ? (
        <span className="cell-tex">
          <OreTexture ore={tile.ore as OreId} amount={tile.amount} />
        </span>
      ) : (
        <span className={`cell-tex cell-ground cell-ground-${seed % 3}`} aria-hidden />
      )}

      {tile.foundation && (
        <span className="cell-foundation" aria-hidden>
          <FoundationSprite />
        </span>
      )}

      {drawEnt && ent && (
        <span className="cell-ent" style={entBig ? bigStyle(entSize.w, entSize.h) : undefined}>
          <EntitySprite
            kind={ent.kind}
            dir={ent.dir}
            lit={lit}
            active={active || lit}
            moving={movingBelt}
            filled={filled}
            toggle={ent.toggle}
            progress={ent.progress}
            cooldown={inserterCd}
            turn={beltBend?.turn}
            flip={ent.flip}
            variant={ent.variant}
          />
        </span>
      )}

      {drawEnt && ent && isInserterKind(ent.kind) && <InserterDirOverlay dir={ent.dir} />}

      {planGhost && !ent && !showGhost && (
        <span className={`cell-ghost cell-plan${planGhost.next ? ' is-next' : ''}`}>
          <EntitySprite kind={planGhost.kind} dir={planGhost.dir} />
          {planGhost.next && <em className="cell-tap-hint">Tap</em>}
        </span>
      )}

      {showGhost && (
        <span className="cell-ghost" style={selBig ? bigStyle(selSize.w, selSize.h) : undefined}>
          {ghostKind === 'foundation' ? (
            <FoundationSprite />
          ) : ghostKind && isEntityPlaceable(ghostKind) ? (
            <EntitySprite kind={ghostKind} dir={ghostDir} flip={ghostFlip} />
          ) : null}
        </span>
      )}

      {showGhost && (ghostKind === 'inserter' || ghostKind === 'longInserter') && (
        <InserterDirOverlay dir={ghostDir} />
      )}

      {bpGhost && !ent && (
        <span className="cell-ghost cell-bp">
          <EntitySprite
            kind={bpGhost.kind}
            dir={bpGhost.dir}
            toggle={bpGhost.toggle}
            flip={bpGhost.flip}
          />
        </span>
      )}

      {(ent?.kind === 'belt' ||
        ent?.kind === 'fastBelt' ||
        ent?.kind === 'undergroundBelt' ||
        ent?.kind === 'splitter') &&
        ent.cargo && (
          <span
            className={`cargo-item${ent.kind === 'fastBelt' ? ' is-fast' : ''}${
              ent.kind === 'undergroundBelt' ? ' is-ug' : ''
            }`}
            style={cargoOffset(ent.dir, ent.cargo.progress, {
              underground: ent.kind === 'undergroundBelt',
              fromDir: beltBend?.from,
            })}
          >
            <ItemSprite item={ent.cargo.item} />
          </span>
        )}

      {drawEnt &&
        ent &&
        (ent.kind === 'drill' ||
          ent.kind === 'electricDrill' ||
          isFurnaceKind(ent.kind) ||
          ent.kind === 'chest' ||
          ent.kind === 'assembler') &&
        storeHasItems(ent) && (
          <span className="cell-store">
            <StoreTags store={ent.store} />
          </span>
        )}

      {ent && (isFurnaceKind(ent.kind) || ent.kind === 'assembler') && ent.smelting && (
        <span className="smelt-bar" style={{ width: `${Math.min(100, ent.progress * 100)}%` }} />
      )}

      {drawEnt && ent && (isGhost || Boolean(ent.marked)) && (
        <span
          className="build-bar"
          style={{
            width: `${Math.min(100, (ent.buildProgress ?? 0) * 100)}%`,
          }}
        />
      )}

      {(isIoPickup || isIoDrop) && (
        <span
          className={['cell-io', isIoPickup ? 'is-from' : '', isIoDrop ? 'is-to' : '']
            .filter(Boolean)
            .join(' ')}
          aria-hidden
        />
      )}

      {(isHover || inHoverFoot || showGhost || isGhost || isInspect || inSelect || planGhost) && (
        <span className="cell-gridline" />
      )}
    </div>
  )
}

export const FloorCell = memo(FloorCellInner, sameCell)
