import type { GameState } from '../state'
import { CO2_RISE, CO2_FILTER_REMOVE, CO2_FILTER_REMOVE_DEGRADED, MAILBOX_FILTER_MUL } from '../constants'

export function co2(s: GameState, dt: number): GameState {
  s.co2 += CO2_RISE * s.mods.drainMul * dt

  if (s.devices.co2Filter.on) {
    const rate = s.devices.co2Filter.degraded
      ? CO2_FILTER_REMOVE_DEGRADED
      : CO2_FILTER_REMOVE
    s.co2 -= rate * (s.mailbox ? MAILBOX_FILTER_MUL : 1) * dt
  }

  s.co2 = Math.max(0, s.co2)
  return s
}
