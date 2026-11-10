import type { GameState, DeviceState, Phase, LoseReason } from '../game/state'
import { LIQO2_PER_TANK, CO2_LETHAL, TEMP_LETHAL, TEMP_INIT, DEV_LETHAL, AMP_REDLINE } from '../game/constants'
import { CTRL_ID } from './controls'

const PHASE_TEXT: Record<Phase, string> = {
  cutscene: '過場 CUTSCENE',
  playing:  '進行中 PLAYING',
  win:      '獲勝 WIN',
  lose:     '失敗 LOSE',
}

const LOSE_TEXT: Record<LoseReason, string> = {
  power:     '電力耗盡 POWER',
  oxygen:    '氧氣耗盡 OXYGEN',
  co2:       '二氧化碳中毒 CO2',
  temp:      '艙溫過低 TEMP',
  deviation: '航道偏離 DEVIATION',
}

function $(id: string): HTMLElement | null {
  return document.getElementById(id)
}

function setText(id: string, text: string): void {
  const el = $(id)
  if (el) el.textContent = text
}

function setBar(id: string, pct: number, danger = false): void {
  const el = $(id)
  if (!el) return
  el.style.width = `${Math.max(0, Math.min(100, pct))}%`
  el.classList.toggle('bar-danger', danger)
}

function formatETA(metSeconds: number): string {
  const total = Math.max(0, Math.floor(metSeconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatLiqO2(liqO2: number): string {
  const tanks = Math.ceil(liqO2 / LIQO2_PER_TANK)
  return Array.from({ length: 3 }, (_, i) => i < tanks ? '■' : '□').join(' ')
}

function deviceLabel(d: DeviceState): string {
  const state = d.on ? 'ON ' : 'off'
  const flag  = d.degraded ? '[!]' : '   '
  return `${state} ${flag}`
}

function setBtn(id: string, text: string, dim: boolean, color?: string): void {
  const el = document.getElementById(id) as HTMLButtonElement | null
  if (!el) return
  el.textContent = text
  el.style.opacity = dim ? '0.3' : '1'
  if (color) el.style.color = color
}

function setBtnClass(id: string, cls: string, on: boolean): void {
  document.getElementById(id)?.classList.toggle(cls, on)
}

function renderPanel(s: GameState, amp: number): void {
  const phaseText = PHASE_TEXT[s.phase] + (s.loseReason ? ' / ' + LOSE_TEXT[s.loseReason] : '')
  setText('cp-phase', phaseText)
  setText('cp-eta', formatETA(s.eta))

  setBar('cp-pwr-bar', s.mainPwr)
  setText('cp-pwr', `${s.mainPwr.toFixed(1)}%`)

  setBar('cp-o2-bar', s.o2Tank)
  setText('cp-o2', `${s.o2Tank.toFixed(1)}%`)

  setText('cp-liqo2', formatLiqO2(s.liqO2))

  const co2Pct = (s.co2 / CO2_LETHAL) * 100
  setBar('cp-co2-bar', co2Pct, s.co2 > CO2_LETHAL * 0.5)
  setText('cp-co2', `${Math.round(s.co2)} ppm`)

  const tempPct = ((s.temp - TEMP_LETHAL) / (TEMP_INIT - TEMP_LETHAL)) * 100
  setBar('cp-temp-bar', tempPct, s.temp < 10)
  setText('cp-temp', `${s.temp.toFixed(1)}°C`)

  const devText = s.devices.navComp.on ? `${s.dev.toFixed(1)}%` : 'ERR'
  setText('cp-dev', devText)
  const needle = $('cp-dev-needle')
  if (needle) {
    const angle = (s.dev / DEV_LETHAL) * 80 - 40
    needle.style.transform = `translateX(-50%) rotate(${angle}deg)`
  }

  const ampPct = (amp / (AMP_REDLINE + 4)) * 100
  setBar('cp-amp-bar', ampPct, amp > AMP_REDLINE)
  setText('cp-amp', `${amp}A`)

  const status = $('cp-status')
  if (status) {
    status.textContent = s.brownout ? '⚡ BROWNOUT — 按下 RESET 復電' : ''
  }

  $('amp-warn-cockpit')?.classList.toggle('visible', amp > AMP_REDLINE)
}

export function render(s: GameState, _tick: number): void {
  const amp = (s.devices.heater.on ? 3 : 0) +
              (s.devices.co2Filter.on ? 5 : 0) +
              (s.devices.navComp.on ? 4 : 0) +
              (s.o2Releasing ? 2 : 0)

  renderPanel(s, amp)

  const brownout = s.brownout

  const hd = s.devices.heater
  const heaterLocked = s.elapsed < hd.lockUntil
  setBtn(CTRL_ID.heater, `加熱 HEATER ${deviceLabel(hd)}`, brownout || heaterLocked)
  setBtnClass(CTRL_ID.heater, 'btn-overheat', !brownout && heaterLocked)
  setBtnClass(CTRL_ID.heater, 'btn-degraded', !brownout && !heaterLocked && hd.degraded)

  const fd = s.devices.co2Filter
  const filterLocked = s.elapsed < fd.lockUntil
  setBtn(CTRL_ID.co2Filter, `濾罐 CO2 ${deviceLabel(fd)}`, brownout || filterLocked)
  setBtnClass(CTRL_ID.co2Filter, 'btn-overheat', !brownout && filterLocked)
  setBtnClass(CTRL_ID.co2Filter, 'btn-degraded', !brownout && !filterLocked && fd.degraded)

  const nd = s.devices.navComp
  const navLocked = s.elapsed < nd.lockUntil
  setBtn(CTRL_ID.navComp, `導航 NAV ${deviceLabel(nd)}`, brownout || navLocked)
  setBtnClass(CTRL_ID.navComp, 'btn-overheat', !brownout && navLocked)
  setBtnClass(CTRL_ID.navComp, 'btn-degraded', !brownout && !navLocked && nd.degraded)

  const o2Empty = s.liqO2 <= 0
  setBtn(CTRL_ID.o2Release,
    o2Empty ? '放氧 O2 EMPTY' : `放氧 O2${s.o2Releasing ? ' ▼' : ''}`,
    brownout || o2Empty)

  const resetEl = document.getElementById(CTRL_ID.reset) as HTMLButtonElement | null
  if (resetEl) resetEl.style.display = brownout ? 'inline-block' : 'none'
}
