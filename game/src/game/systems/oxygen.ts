import type { GameState } from '../state'
import { O2_DRAIN, O2_RELEASE_GAIN } from '../constants'

export function oxygen(s: GameState, dt: number): GameState {
  s.o2Releasing = s.o2Held && s.liqO2 > 0 && !s.brownout

  if (s.o2Releasing) {
    const use = Math.min(dt, s.liqO2)   // 最後不足一幀不溢領
    s.o2Tank = Math.min(100, s.o2Tank + O2_RELEASE_GAIN * use)
    s.liqO2 = Math.max(0, s.liqO2 - dt)
  }

  s.o2Tank = Math.max(0, s.o2Tank - O2_DRAIN * s.mods.drainMul * dt)  // 自然消耗恆發生
  return s
}
