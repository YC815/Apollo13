import type { GameState } from '../state'
import { computeMET } from '../state'
import { MISSION_EVENTS } from '../mission'

/**
 * 任務事件：依 MET 觸發歷史事件；管理點火視窗。
 * 點火成立條件：視窗開啟 + 按住點火 + 導航開 + DEV ≤ 容許值。
 * 引擎點火時多吃 AMP_ENGINE 安培（由 computeAmp 讀 s.burning）。
 */
export function events(s: GameState, dt: number): GameState {
  // 1. 觸發到期事件（一次最多一個，避免同幀疊加）
  const ev = MISSION_EVENTS[s.nextEvent]
  if (ev && computeMET(s) >= ev.met && !s.burn) {
    s.nextEvent++
    s.log.push({ t: s.elapsed, kind: ev.burn ? 'burn-open' : 'event', id: ev.id })
    if (ev.burn) {
      s.burn = {
        id: ev.id,
        until: s.elapsed + ev.burn.window * s.mods.burnTimeMul,
        progress: 0,
        hold: ev.burn.hold,
        tol: ev.burn.tol + s.mods.burnTolBonus,
      }
    }
    if (ev.losSeconds) s.losUntil = s.elapsed + ev.losSeconds
    if (ev.id === 'mailbox') s.mailbox = true
  }

  // 2. 點火視窗
  const b = s.burn
  s.burning = !!b && s.burnHeld && !s.brownout
  if (b) {
    const spec = MISSION_EVENTS.find(e => e.id === b.id)!.burn!
    if (s.burning && s.devices.navComp.on && s.dev <= b.tol) b.progress += dt

    if (b.progress >= b.hold) {
      if (spec.success.devZero) s.dev = 0
      if (spec.success.etaHours) s.eta = Math.max(0, s.eta - spec.success.etaHours * 3600)
      s.stats.burnsOk++
      s.log.push({ t: s.elapsed, kind: 'burn-ok', id: b.id })
      s.burn = null
      s.burning = false
    } else if (s.elapsed >= b.until) {
      if (spec.fail.dev) s.dev = Math.min(100, s.dev + spec.fail.dev)
      if (spec.fail.etaHours) s.eta += spec.fail.etaHours * 3600
      s.stats.burnsFailed++
      s.log.push({ t: s.elapsed, kind: 'burn-fail', id: b.id })
      s.burn = null
      s.burning = false
    }
  }
  return s
}
