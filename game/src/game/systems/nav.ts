import type { GameState } from '../state'
import {
  COMPRESSION,
  DEV_CORRECT, DEV_CORRECT_DEGRADED,
  DEV_DRIFT_MAX, DEV_DRIFT_MAX_COLD,
  DEV_PENALTY_PER_PCT, DEV_BIG_THRESHOLD, DEV_BIG_PENALTY,
  TEMP_FROST,
} from '../constants'

export function nav(s: GameState, dt: number): GameState {
  if (s.devices.navComp.on) {
    s.eta = Math.max(0, s.eta - COMPRESSION * dt)
    const rate = s.devices.navComp.degraded ? DEV_CORRECT_DEGRADED : DEV_CORRECT
    s.dev = Math.max(0, s.dev - rate * dt)
    s.devDriftAcc = 1  // 預備：下次盲飛首幀立即抽樣（D-003）
  } else {
    s.devDriftAcc += dt
    if (s.devDriftAcc >= 1) {
      s.devDriftAcc -= 1
      const max = s.temp < TEMP_FROST ? DEV_DRIFT_MAX_COLD : DEV_DRIFT_MAX
      s.devDriftSample = s.rng() * max * s.mods.driftMul
    }
    const drift = s.devDriftSample * dt  // %
    s.dev = Math.min(100, s.dev + drift)
    s.eta += drift * DEV_PENALTY_PER_PCT * COMPRESSION  // 漂移債（D-002）
  }

  if (!s.dev30PenaltyApplied && s.dev > DEV_BIG_THRESHOLD) {
    s.dev30PenaltyApplied = true
    s.eta += DEV_BIG_PENALTY * COMPRESSION  // D-002：懲罰用 real 秒 ×652.5
  }

  return s
}
