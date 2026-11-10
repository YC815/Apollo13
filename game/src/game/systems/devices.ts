import type { GameState, DeviceId } from '../state'
import { computeAmp } from '../state'
import type { OverheatingId } from '../constants'
import {
  AMP_REDLINE, BROWNOUT_SECONDS, BROWNOUT_PWR_PENALTY,
  OVERHEAT_LIMIT, OVERHEAT_COOL_RATE, LOCK_SECONDS,
} from '../constants'

// 跳電時關閉的對象：全部設備（都會耗電）
const DEVICE_IDS: DeviceId[] = ['heater', 'co2Filter', 'navComp']
// 會過熱的設備：由 OVERHEAT_LIMIT 表推導（唯一真相），不在表裡的不跑 heat 邏輯
const OVERHEATING_IDS = Object.keys(OVERHEAT_LIMIT) as OverheatingId[]

export function devices(s: GameState, dt: number): GameState {
  const amp = computeAmp(s)

  if (!s.brownout) {
    s.ampOverRedSeconds = amp > AMP_REDLINE ? s.ampOverRedSeconds + dt : 0
    if (s.ampOverRedSeconds >= BROWNOUT_SECONDS) {
      s.brownout = true
      for (const id of DEVICE_IDS) s.devices[id].on = false
      s.o2Held = false
      s.burnHeld = false
      s.burning = false
      s.mainPwr = Math.max(0, s.mainPwr - BROWNOUT_PWR_PENALTY)
      if (s.lastDeviceOn && s.rng() < s.mods.degradeChance)
        s.devices[s.lastDeviceOn].degraded = true
      s.stats.brownouts++
      s.log.push({ t: s.elapsed, kind: 'brownout', id: s.lastDeviceOn ?? undefined })
      s.ampOverRedSeconds = 0
    }
  }

  for (const id of OVERHEATING_IDS) {
    const d = s.devices[id]
    const locked = s.elapsed < d.lockUntil
    if (d.on && !locked) d.heat += dt
    else d.heat = Math.max(0, d.heat - OVERHEAT_COOL_RATE * dt)
    if (d.heat >= OVERHEAT_LIMIT[id] * s.mods.overheatMul) {
      d.on = false
      d.lockUntil = s.elapsed + LOCK_SECONDS
      s.stats.overheats++
      s.log.push({ t: s.elapsed, kind: 'overheat', id })
    }
  }

  return s
}
