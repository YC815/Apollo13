import type { GameState, DeviceId } from '../src/game/state'
import { computeAmp } from '../src/game/state'
import { AMP, AMP_REDLINE, AMP_ENGINE, OVERHEAT_LIMIT } from '../src/game/constants'
import type { PlayerAgent, PlayerIntent } from './playerAgent'
import { IDLE } from './playerAgent'

// rotate 策略的決策門檻（具名常數方便調）
const ROTATE_DEV_DANGER = 35      // % → 優先開導航壓回來
const ROTATE_CO2_DANGER = 7000    // PPM → 優先開濾毒
const ROTATE_TEMP_DANGER = 7      // °C → 優先開暖氣
const ROTATE_O2_DANGER = 25       // % → 優先補氧
const ROTATE_HEAT_RATIO = 0.8     // 達過熱上限幾成就主動關掉

// ─────────────────────────────────────────────────────────────────────────────

export const doNothing: PlayerAgent = {
  name: 'do-nothing',
  description: '完全不操作，驗證不操作的死法（真實 RNG 下 DEV 先殺）',
  decide: () => IDLE,
}

export const co2Only: PlayerAgent = {
  name: 'co2-only',
  description: '只管濾毒，驗證單顧 CO2 的隧道視野（DEV 仍會殺）',
  decide(s, _t): PlayerIntent {
    const toggles: DeviceId[] = []
    const d = s.devices.co2Filter
    if (!d.on && s.elapsed >= d.lockUntil) toggles.push('co2Filter')
    return { toggles, o2Held: false, reset: false }
  },
}

export const panic: PlayerAgent = {
  name: 'panic',
  description: '第 0 秒全開設備 + 補氧，驗證跳電機制與懲罰',
  decide(_s, t): PlayerIntent {
    if (t === 0) return { toggles: ['heater', 'co2Filter', 'navComp'], o2Held: true, reset: false }
    return IDLE
  },
}

export const navOnly: PlayerAgent = {
  name: 'nav-only',
  description: '只管導航，驗證壓住 DEV 但 CO2 牆還在（約 480s co2 死）',
  decide(s, _t): PlayerIntent {
    const toggles: DeviceId[] = []
    const d = s.devices.navComp
    if (!d.on && s.elapsed >= d.lockUntil) toggles.push('navComp')
    return { toggles, o2Held: false, reset: false }
  },
}

export function makeRotateAgent(): PlayerAgent {
  return {
    name: 'rotate',
    description: '分時輪轉：按「離死線多近」決定優先序，目標讓 ETA 歸零',
    decide(s: Readonly<GameState>, _t: number): PlayerIntent {
      const toggles: DeviceId[] = []
      let o2Held = false
      let reset = false

      // 1. 跳電中先 reset
      if (s.brownout) { reset = true; return { toggles, o2Held, reset } }

      // 主動散熱：接近過熱上限就關掉讓它冷，避免引擎強制鎖定
      // 只看會過熱的設備（OVERHEAT_LIMIT 表）；navComp 不過熱，導航全程開
      for (const id of Object.keys(OVERHEAT_LIMIT) as (keyof typeof OVERHEAT_LIMIT)[]) {
        const d = s.devices[id]
        if (d.on && d.heat >= OVERHEAT_LIMIT[id] * ROTATE_HEAT_RATIO) {
          toggles.push(id)
          return { toggles, o2Held, reset }
        }
      }

      // 開某設備前先估算 AMP 會不會超線
      function canAdd(amp: number): boolean {
        return computeAmp(s as GameState) + amp <= AMP_REDLINE
      }
      function isAvailable(id: DeviceId): boolean {
        return !s.devices[id].on && s.elapsed >= s.devices[id].lockUntil
      }

      // 1.5 點火視窗：導航開、關掉濾罐騰安培、DEV 夠低就按住點火
      if (s.burn) {
        if (isAvailable('navComp') && canAdd(AMP.navComp)) {
          toggles.push('navComp')
          return { toggles, o2Held, reset }
        }
        if (s.devices.navComp.on && s.dev <= s.burn.tol) {
          const extra = s.burning ? 0 : AMP_ENGINE
          if (computeAmp(s as GameState) + extra > AMP_REDLINE && s.devices.co2Filter.on) toggles.push('co2Filter')
          else if (computeAmp(s as GameState) + extra > AMP_REDLINE && s.devices.heater.on) toggles.push('heater')
          return { toggles, o2Held, reset, burn: computeAmp(s as GameState) + extra <= AMP_REDLINE || toggles.length > 0 }
        }
      }

      // 2. DEV 危險 → 開導航
      if (s.dev > ROTATE_DEV_DANGER && isAvailable('navComp') && canAdd(AMP.navComp)) {
        toggles.push('navComp')
        return { toggles, o2Held, reset }
      }

      // 3. CO2 危險 → 開濾毒
      if (s.co2 > ROTATE_CO2_DANGER && isAvailable('co2Filter') && canAdd(AMP.co2Filter)) {
        toggles.push('co2Filter')
        return { toggles, o2Held, reset }
      }

      // 4. TEMP 危險 → 開暖氣
      if (s.temp < ROTATE_TEMP_DANGER && isAvailable('heater') && canAdd(AMP.heater)) {
        toggles.push('heater')
        return { toggles, o2Held, reset }
      }

      // 5. O2 危險 → 補氧（補氧會降溫，跟暖氣衝突，選其一）
      if (s.o2Tank < ROTATE_O2_DANGER && s.liqO2 > 0 && canAdd(AMP.o2Release)) {
        o2Held = true
        return { toggles, o2Held, reset }
      }

      // 6. 平時：盡量開導航推 ETA（贏的唯一途徑）
      if (isAvailable('navComp') && canAdd(AMP.navComp)) {
        toggles.push('navComp')
      }

      return { toggles, o2Held, reset }
    },
  }
}

/**
 * smart：以「離死線還有幾秒」排序，濾罐與暖氣接力（導航全程開、兩者互斥以守 10A），
 * 接近過熱就換手；點火視窗照 rotate 的方式處理。用來驗證困難模式可贏。
 */
export function makeSmartAgent(): PlayerAgent {
  const rotate = makeRotateAgent()
  return {
    name: 'smart',
    description: '依剩餘秒數決定濾罐/暖氣接力，驗證困難模式可贏',
    decide(s: Readonly<GameState>, t: number): PlayerIntent {
      if (s.brownout || s.burn) return rotate.decide(s, t)
      const toggles: DeviceId[] = []
      const nav = s.devices.navComp
      if (!nav.on && s.elapsed >= nav.lockUntil) return { toggles: ['navComp'], o2Held: false, reset: false }
      const k = s.mods.drainMul
      const tempLeft = s.temp / (0.035 * k)
      const co2Left = (10000 - s.co2) / (20 * k)
      const want: DeviceId = tempLeft < co2Left ? 'heater' : 'co2Filter'
      const other: DeviceId = want === 'heater' ? 'co2Filter' : 'heater'
      const lim = (id: 'heater' | 'co2Filter') => OVERHEAT_LIMIT[id] * s.mods.overheatMul
      const hot = (id: 'heater' | 'co2Filter') => s.devices[id].heat >= lim(id) * 0.9
      const ok = (id: 'heater' | 'co2Filter') => s.elapsed >= s.devices[id].lockUntil && !hot(id)
      const pick = ok(want) ? want : ok(other) ? other : null
      for (const id of ['heater', 'co2Filter'] as const) {
        if (s.devices[id].on && (id !== pick)) toggles.push(id)
      }
      if (pick && !s.devices[pick].on) toggles.push(pick)
      const o2Held = s.o2Tank < 22 && s.liqO2 > 0 && !(pick === 'co2Filter' && s.devices.co2Filter.on && !toggles.includes('co2Filter'))
      return { toggles, o2Held, reset: false }
    },
  }
}

export const STRATEGIES: PlayerAgent[] = [
  doNothing,
  co2Only,
  panic,
  navOnly,
  makeRotateAgent(),
]
