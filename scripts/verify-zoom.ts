/**
 * Zoom-out cannot mount the whole 240x160 factory or divide by a 0 zoom.
 */
import {
  CELL,
  MAX_VIS_COLS,
  MAX_VIS_ROWS,
  ZOOM_MIN,
  cellCount,
  clampZoom,
  visibleCellRange,
} from '../src/game/camera.ts'

function fail(msg: string): never {
  throw new Error(msg)
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg)
}

{
  const z = clampZoom(0.1, { width: 1100, height: 700 })
  assert(z >= 1100 / (MAX_VIS_COLS * CELL) - 0.02, 'tablet min zoom must keep columns capped')
  assert(z >= ZOOM_MIN, 'clamp never goes below the floor')
  assert(clampZoom(9) === 2.2, 'clamp hits the max')
  assert(clampZoom(Number.NaN) >= ZOOM_MIN, 'NaN zoom falls back to a safe value')
}

{
  const wide = visibleCellRange({ x: 12, y: 48 }, 0.45, { width: 1180, height: 820 }, 240, 160)
  assert(wide.x1 - wide.x0 + 1 <= MAX_VIS_COLS, 'zoomed-out columns stay under the cap')
  assert(wide.y1 - wide.y0 + 1 <= MAX_VIS_ROWS, 'zoomed-out rows stay under the cap')
  assert(cellCount(wide) <= MAX_VIS_COLS * MAX_VIS_ROWS, 'visible cell count is bounded')
}

{
  const bad = visibleCellRange(
    { x: Number.NEGATIVE_INFINITY, y: Number.NaN },
    0,
    { width: 800, height: 600 },
    240,
    160,
  )
  assert(Number.isFinite(bad.x0) && Number.isFinite(bad.x1), 'bad pan does not yield infinite x')
  assert(Number.isFinite(bad.y0) && Number.isFinite(bad.y1), 'bad pan does not yield infinite y')
  assert(bad.x1 >= bad.x0 && bad.y1 >= bad.y0, 'range stays ordered')
  assert(cellCount(bad) <= MAX_VIS_COLS * MAX_VIS_ROWS, 'broken camera still caps the grid')
}

{
  const inClose = visibleCellRange({ x: 12, y: 48 }, 2.2, { width: 390, height: 700 }, 240, 160)
  assert(cellCount(inClose) < 200, 'zoomed-in phone view stays a small grid')
}

{
  const view = { width: 1100, height: 700 }
  let pan = { x: 12, y: 48 }
  const steps = [0.3, 0.45, 0.7, 1.2, 2.2, 1.1, 0.45, 2.2]
  for (const raw of steps) {
    const z = clampZoom(raw, view)
    const range = visibleCellRange(pan, z, view, 240, 160)
    const n = cellCount(range)
    assert(Number.isFinite(n) && n > 0, `zoom ${raw} produced a finite grid`)
    assert(n <= MAX_VIS_COLS * MAX_VIS_ROWS, `zoom ${raw} stayed under the cell cap`)
    pan = { x: pan.x * (z / 0.85), y: pan.y * (z / 0.85) }
  }
}

console.log('verify-zoom: ok')
