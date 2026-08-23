/**
 * Tablet HUD: icon-only materials, overlay chrome, compact dock.
 */
import { readFileSync } from 'node:fs'

function fail(msg: string): never {
  throw new Error(msg)
}

function assert(cond: unknown, msg: string): void {
  if (!cond) fail(msg)
}

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
const floor = readFileSync(new URL('../src/components/FactoryFloor.tsx', import.meta.url), 'utf8')

const resName = css.slice(css.indexOf('.game-res-name {'), css.indexOf('.game-res.is-pulse'))
assert(/display:\s*none/.test(resName), 'HUD resource names stay hidden until tap')

assert(/namedMat/.test(floor), 'tapping a material stores the named item')
assert(/setNamedMat\(\(cur\) =>/.test(floor), 'material chips toggle the named item on tap')
assert(/<button[\s\S]*className=\{`game-res/.test(floor), 'material chips are buttons')
assert(
  /\{namedMat \? ITEM_META\[namedMat\]\.label : 'Mats'\}/.test(floor),
  'tap replaces the Mats label with the resource name',
)

const hud = css.slice(css.indexOf('.game-hud {'), css.indexOf('.game-hud-top {'))
assert(/position:\s*absolute/.test(hud), 'HUD overlays the factory instead of eating a grid row')

assert(
  /--hud-clearance/.test(css) && /setProperty\('--hud-clearance'/.test(floor),
  'inspect and mode banners sit below the live HUD height',
)

assert(
  /@media \(min-width: 700px\), \(orientation: landscape\)/.test(css),
  'tablet / landscape media query compact the dock and rail',
)
assert(
  /\.game-stage \{[\s\S]*?padding-bottom:\s*calc\(3\.15rem/.test(css),
  'tablet dock leaves more height for the factory',
)

assert(
  /\.store-tag-name \{[\s\S]*?display:\s*none/.test(css),
  'floor store tags drop resource names',
)
assert(
  /\.inspect-store \.store-tag-name \{[\s\S]*?display:\s*block/.test(css),
  'inspect still shows material names',
)

console.log('verify-tablet-hud: ok')
