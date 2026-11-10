import type { DeviceId } from './state'
import { initialState } from './state'
import { FIXED_DT, MAX_FRAME } from './constants'
import { step } from './systems/index'
import { render } from '../ui/dashboard'
import { updateScene3d } from '../ui/scene3d'
import { updateVignette, updateFrost, updateCursorDrift } from '../ui/effects'
import { applyToggleDevice, applySetO2Held, applyReset } from './input'

let state = initialState()
let last = performance.now()
let acc = 0
let tick = 0

function frame(now: number): void {
  acc += Math.min((now - last) / 1000, MAX_FRAME)
  last = now
  while (acc >= FIXED_DT) {
    state = step(state, FIXED_DT)
    tick++
    acc -= FIXED_DT
  }
  render(state, tick)
  updateScene3d(state)
  updateVignette(state)
  updateFrost(state)
  updateCursorDrift(state)
  requestAnimationFrame(frame)
}

export function startLoop(): void {
  requestAnimationFrame(frame)
}

// ── 輸入 handlers（薄包裝，規則在 input.ts）────────────────────────────────

export function toggleDevice(id: DeviceId): void { state = applyToggleDevice(state, id) }
export function setO2Held(held: boolean): void   { state = applySetO2Held(state, held) }
export function doReset(): void                  { state = applyReset(state) }
