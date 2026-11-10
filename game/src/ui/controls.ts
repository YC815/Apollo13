import type { DeviceId } from '../game/state'

export type InputHandlers = {
  toggleDevice: (id: DeviceId) => void
  setO2Held: (held: boolean) => void
  doReset: () => void
}

// 按鈕 ID，dashboard.ts 用 getElementById 找到它們
export const CTRL_ID = {
  heater:    'ctrl-heater',
  co2Filter: 'ctrl-filter',
  navComp:   'ctrl-nav',
  o2Release: 'ctrl-o2',
  reset:     'ctrl-reset',
} as const

function makeBtn(id: string, label: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.id = id
  el.textContent = label
  return el
}

export function setupControls(h: InputHandlers): void {
  const row = document.getElementById('controls-slot-cockpit')!

  const heaterBtn = makeBtn(CTRL_ID.heater, '加熱 HEATER off')
  const filterBtn = makeBtn(CTRL_ID.co2Filter, '濾罐 CO2 off')
  const navBtn    = makeBtn(CTRL_ID.navComp, '導航 NAV off')
  const o2Btn     = makeBtn(CTRL_ID.o2Release, '放氧 O2')
  const resetBtn  = makeBtn(CTRL_ID.reset, '!! RESET !!')
  resetBtn.classList.add('btn-reset')
  resetBtn.style.display = 'none'

  heaterBtn.addEventListener('click', () => h.toggleDevice('heater'))
  filterBtn.addEventListener('click', () => h.toggleDevice('co2Filter'))
  navBtn.addEventListener('click',    () => h.toggleDevice('navComp'))

  // pointer events: mousedown/touchstart 兩者都用 pointerdown 統一處理
  o2Btn.addEventListener('pointerdown',  (e) => { e.preventDefault(); h.setO2Held(true) })
  o2Btn.addEventListener('pointerup',    () => h.setO2Held(false))
  o2Btn.addEventListener('pointerleave', () => h.setO2Held(false))
  o2Btn.addEventListener('pointercancel',() => h.setO2Held(false))

  resetBtn.addEventListener('click', () => h.doReset())

  row.append(heaterBtn, filterBtn, navBtn, o2Btn, resetBtn)
}
