import type { DeviceId, Difficulty, GameState } from './state'
import { initialState } from './state'
import { FIXED_DT, MAX_FRAME } from './constants'
import { step } from './systems/index'
import { applyToggleDevice, applySetO2Held, applyReset, applySetBurnHeld } from './input'

/**
 * 固定步長遊戲迴圈。外部（main.ts）決定何時開始、暫停，並在每個畫格拿 state 去畫。
 */
let state: GameState = initialState()
let running = false
let last = 0
let acc = 0

export function getState(): GameState { return state }
export function isRunning(): boolean { return running }

export function newGame(difficulty: Difficulty): GameState {
  state = initialState(difficulty)
  // 開局導航已開：太空人的第一個動作就是保持航向（困難模式則全部關閉）
  if (difficulty !== 'hard') applyToggleDevice(state, 'navComp')
  acc = 0
  return state
}

export function setRunning(r: boolean): void {
  running = r
  last = performance.now()
  if (!r) { state.o2Held = false; state.burnHeld = false }
}

/** 每個 requestAnimationFrame 呼叫一次；回傳是否推進了模擬 */
export function tick(now: number): boolean {
  if (!running || state.phase !== 'playing') { last = now; return false }
  acc += Math.min((now - last) / 1000, MAX_FRAME)
  last = now
  while (acc >= FIXED_DT && state.phase === 'playing') {
    state = step(state, FIXED_DT)
    acc -= FIXED_DT
  }
  return true
}

export function toggleDevice(id: DeviceId): void { state = applyToggleDevice(state, id) }
export function setO2Held(held: boolean): void { state = applySetO2Held(state, held) }
export function setBurnHeld(held: boolean): void { state = applySetBurnHeld(state, held) }
export function doReset(): void { state = applyReset(state) }
