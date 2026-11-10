import type { GameState } from '../state'
import { TEMP_HEATER, TEMP_HEATER_DEGRADED, O2_RELEASE_TEMP, TEMP_NATURAL } from '../constants'

export function temp(s: GameState, dt: number): GameState {
  if (s.devices.heater.on) {
    const rate = s.devices.heater.degraded ? TEMP_HEATER_DEGRADED : TEMP_HEATER
    s.temp += rate * dt
  }
  if (s.o2Releasing) s.temp -= O2_RELEASE_TEMP * dt
  s.temp -= TEMP_NATURAL * s.mods.drainMul * dt  // 不 clamp，死亡交給 checkWinLose
  return s
}
