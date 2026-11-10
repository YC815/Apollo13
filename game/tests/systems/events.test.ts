import { describe, it, expect } from 'vitest'
import { initialState, computeMET, computeAmp } from '../../src/game/state'
import { step } from '../../src/game/systems/index'
import { applySetBurnHeld } from '../../src/game/input'
import { FIXED_DT, MET_START, ETA_INIT } from '../../src/game/constants'
import { MISSION_EVENTS } from '../../src/game/mission'

function atMET(met: number) {
  const s = initialState()
  s.rng = () => 0
  s.eta = ETA_INIT - (met - MET_START)
  return s
}

describe('任務事件 / 點火視窗', () => {
  it('起點 MET = 55:54:00', () => {
    expect(computeMET(initialState())).toBe(55 * 3600 + 54 * 60)
  })

  it('到達 DPS-1 時刻開啟點火視窗', () => {
    let s = atMET(MISSION_EVENTS[0].met)
    s = step(s, FIXED_DT)
    expect(s.burn?.id).toBe('dps1')
    expect(s.log[s.log.length - 1]?.kind).toBe('burn-open')
  })

  it('導航開 + DEV 夠低 + 按住點火 → 成功；點火時多吃 2A', () => {
    let s = atMET(MISSION_EVENTS[0].met)
    s.devices.navComp.on = true
    s = step(s, FIXED_DT)
    applySetBurnHeld(s, true)
    s = step(s, FIXED_DT)
    expect(computeAmp(s)).toBe(4 + 2)
    for (let i = 0; i < 60 * 6 && s.burn; i++) s = step(s, FIXED_DT)
    expect(s.burn).toBeNull()
    expect(s.stats.burnsOk).toBe(1)
  })

  it('沒按點火 → 視窗結束判失敗，DEV 受罰', () => {
    let s = atMET(MISSION_EVENTS[0].met)
    s.devices.navComp.on = true
    for (let i = 0; i < 60 * 30 && s.stats.burnsFailed === 0; i++) s = step(s, FIXED_DT)
    expect(s.stats.burnsFailed).toBe(1)
    expect(s.dev).toBeGreaterThan(10)
  })

  it('視窗外按點火無效', () => {
    const s = initialState()
    applySetBurnHeld(s, true)
    expect(s.burnHeld).toBe(false)
  })

  it('郵箱事件後濾罐增效', () => {
    const ev = MISSION_EVENTS.find(e => e.id === 'mailbox')!
    let s = atMET(ev.met)
    s.nextEvent = MISSION_EVENTS.indexOf(ev)
    s = step(s, FIXED_DT)
    expect(s.mailbox).toBe(true)
  })
})
