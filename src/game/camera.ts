/** Pixel size of one factory tile. Keep in sync with CSS .cell width. */
export const CELL = 56
export const ZOOM_MIN = 0.45
export const ZOOM_MAX = 2.2
/** Extra tiles past the viewport so 3x3 sprites do not pop. */
export const CULL_PAD = 2
/** Hard cap so a pinch-out cannot mount the whole 240x160 grid. */
export const MAX_VIS_COLS = 36
export const MAX_VIS_ROWS = 24

export type CameraPan = { x: number; y: number }
export type ViewSize = { width: number; height: number }
export type CellRange = { x0: number; y0: number; x1: number; y1: number }

export function clampZoom(z: number, view: ViewSize = { width: 0, height: 0 }): number {
  let min = ZOOM_MIN
  if (view.width > 0) min = Math.max(min, view.width / (MAX_VIS_COLS * CELL))
  if (view.height > 0) min = Math.max(min, view.height / (MAX_VIS_ROWS * CELL))
  min = Math.min(min, ZOOM_MAX)
  if (!Number.isFinite(z)) return Math.max(min, 0.85)
  return Math.min(ZOOM_MAX, Math.max(min, Math.round(z * 100) / 100))
}

export function visibleCellRange(
  pan: CameraPan,
  zoom: number,
  viewport: ViewSize,
  mapW: number,
  mapH: number,
): CellRange {
  const z = Number.isFinite(zoom) && zoom > 0.05 ? zoom : ZOOM_MIN
  const cell = CELL * z
  const vw = Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 1024
  const vh = Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 768
  const px = Number.isFinite(pan.x) ? pan.x : 0
  const py = Number.isFinite(pan.y) ? pan.y : 0

  let x0 = Math.floor(-px / cell) - CULL_PAD
  let y0 = Math.floor(-py / cell) - CULL_PAD
  let x1 = Math.ceil((vw - px) / cell) + CULL_PAD
  let y1 = Math.ceil((vh - py) / cell) + CULL_PAD

  if (!Number.isFinite(x0)) x0 = 0
  if (!Number.isFinite(y0)) y0 = 0
  if (!Number.isFinite(x1)) x1 = x0
  if (!Number.isFinite(y1)) y1 = y0

  x0 = Math.min(mapW - 1, Math.max(0, x0))
  y0 = Math.min(mapH - 1, Math.max(0, y0))
  x1 = Math.min(mapW - 1, Math.max(x0, x1))
  y1 = Math.min(mapH - 1, Math.max(y0, y1))

  const cols = x1 - x0 + 1
  const rows = y1 - y0 + 1
  if (cols > MAX_VIS_COLS) {
    const extra = cols - MAX_VIS_COLS
    x0 += Math.floor(extra / 2)
    x1 = x0 + MAX_VIS_COLS - 1
  }
  if (rows > MAX_VIS_ROWS) {
    const extra = rows - MAX_VIS_ROWS
    y0 += Math.floor(extra / 2)
    y1 = y0 + MAX_VIS_ROWS - 1
  }
  return { x0, y0, x1, y1 }
}

export function cellCount(range: CellRange): number {
  return (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1)
}
