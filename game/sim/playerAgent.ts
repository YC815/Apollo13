import type { GameState, DeviceId } from '../src/game/state'

/**
 * 本模擬秒玩家想做的事。
 * - toggles：想「切換」哪些設備（off↔on）。runner 對每個 id 呼叫 applyToggleDevice。
 * - o2Held：本秒是否按住補氧閥（持續意圖，不是脈衝）。
 * - reset：本秒是否要點 RESET（只在跳電時有意義）。
 */
export type PlayerIntent = {
  toggles: DeviceId[]
  o2Held: boolean
  reset: boolean
  burn?: boolean   // 按住點火（只在點火視窗內有效）
}

export type PlayerAgent = {
  name: string
  description: string
  decide(s: Readonly<GameState>, t: number): PlayerIntent
}

export const IDLE: PlayerIntent = { toggles: [], o2Held: false, reset: false }
