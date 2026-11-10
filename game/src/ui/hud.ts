/**
 * 駕駛艙 HUD：CRT 讀數、軌道圖、安培表、開關/閥門/點火/斷路器的狀態呈現。
 * 只讀 GameState；輸入綁定在 input.ts。
 */
import type { GameState, DeviceId } from '../game/state'
import { computeAmp, computeMET } from '../game/state'
import {
  AMP, AMP_ENGINE, AMP_REDLINE, BROWNOUT_SECONDS, CO2_LETHAL, DEV_LETHAL, ETA_INIT,
  LIQO2_PER_TANK, OVERHEAT_LIMIT, MET_START, DEV_DRIFT_MAX, DEV_DRIFT_MAX_COLD, TEMP_FROST,
} from '../game/constants'
import { MISSION_EVENTS, formatMET } from '../game/mission'
import { viewLabel } from './space'

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T
const SVGNS = 'http://www.w3.org/2000/svg'
const svg = (tag: string, attrs: Record<string, string | number>, parent?: Element) => {
  const el = document.createElementNS(SVGNS, tag)
  for (const k in attrs) el.setAttribute(k, String(attrs[k]))
  parent?.appendChild(el)
  return el
}

// ════════════════ CRT 讀數 ════════════════
type Level = '' | 'caution' | 'warning'
type RowDef = {
  key: 'pwr' | 'o2' | 'co2' | 'temp' | 'dev'
  label: string; zh: string
  min: number; max: number
  /** 危險方向：-1 = 往下會死（電/氧/溫）、+1 = 往上會死（CO2/DEV） */
  dir: -1 | 1
  lethal: number
  caution: number; warning: number
  unit: string
  fmt: (v: number) => string
  rateFmt: (r: number) => string
}
const ROWS: RowDef[] = [
  { key: 'pwr', label: 'MAIN PWR', zh: '主電力', min: 0, max: 100, dir: -1, lethal: 0, caution: 30, warning: 15, unit: '%', fmt: v => v.toFixed(1), rateFmt: r => `${r.toFixed(2)}%/s` },
  { key: 'o2', label: 'O2 TANK', zh: '艙內氧氣', min: 0, max: 100, dir: -1, lethal: 0, caution: 30, warning: 15, unit: '%', fmt: v => v.toFixed(1), rateFmt: r => `${r.toFixed(2)}%/s` },
  { key: 'co2', label: 'CO2 LVL', zh: '二氧化碳', min: 0, max: CO2_LETHAL, dir: 1, lethal: CO2_LETHAL, caution: 5000, warning: 8000, unit: 'ppm', fmt: v => Math.round(v).toString(), rateFmt: r => `${r.toFixed(0)}/s` },
  { key: 'temp', label: 'CABIN TEMP', zh: '艙內溫度', min: 0, max: 25, dir: -1, lethal: 0, caution: 10, warning: 4, unit: '°C', fmt: v => v.toFixed(1), rateFmt: r => `${r.toFixed(2)}°/s` },
  { key: 'dev', label: 'DEVIATION', zh: '軌道偏離', min: 0, max: DEV_LETHAL, dir: 1, lethal: DEV_LETHAL, caution: 20, warning: 35, unit: '%', fmt: v => v.toFixed(1), rateFmt: r => `${r.toFixed(2)}%/s` },
]

type RowEl = { root: HTMLElement; fill: HTMLElement; range: HTMLElement; val: HTMLElement; trend: HTMLElement; ttl: HTMLElement; extra?: HTMLElement }
const rowEls: Record<string, RowEl> = {}
const rate: Record<string, number> = {}
const prev: Record<string, number> = {}
let prevElapsed = 0

// 盲飛 DEV 估計：最後已知值 + 經過秒數 × 漂移上限
let lastKnownDev = 0
let blindSince = -1

function valueOf(s: GameState, k: RowDef['key']): number {
  switch (k) {
    case 'pwr': return s.mainPwr
    case 'o2': return s.o2Tank
    case 'co2': return s.co2
    case 'temp': return s.temp
    case 'dev': return s.dev
  }
}

function pct(d: RowDef, v: number): number { return Math.max(0, Math.min(100, ((v - d.min) / (d.max - d.min)) * 100)) }

function buildReadouts(): void {
  const host = $('#readouts')
  host.innerHTML = ''
  for (const d of ROWS) {
    const root = document.createElement('div')
    root.className = 'ro'
    root.dataset.key = d.key
    const zoneW = d.dir === 1
      ? `<div class="ro-zone caution" style="left:${pct(d, d.caution)}%;width:${pct(d, d.warning) - pct(d, d.caution)}%"></div><div class="ro-zone" style="left:${pct(d, d.warning)}%;right:0"></div>`
      : `<div class="ro-zone" style="left:0;width:${pct(d, d.warning)}%"></div><div class="ro-zone caution" style="left:${pct(d, d.warning)}%;width:${pct(d, d.caution) - pct(d, d.warning)}%"></div>`
    root.innerHTML = `
      <div class="ro-label"><b>${d.label}</b><small>${d.zh}</small></div>
      <div class="ro-bar">${zoneW}<div class="ro-fill"></div><div class="ro-range" hidden></div></div>
      <div class="ro-value"><span class="v">--</span><small>${d.unit}</small></div>
      <div class="ro-sub"><span class="trend"></span>${d.key === 'o2' ? '<span class="liq"></span>' : ''}<span class="ttl"></span></div>`
    host.appendChild(root)
    rowEls[d.key] = {
      root,
      fill: root.querySelector('.ro-fill')!,
      range: root.querySelector('.ro-range')!,
      val: root.querySelector('.v')!,
      trend: root.querySelector('.trend')!,
      ttl: root.querySelector('.ttl')!,
      extra: root.querySelector('.liq') as HTMLElement ?? undefined,
    }
  }
}

function fmtSec(t: number): string {
  if (t >= 600) return '—'
  const m = Math.floor(t / 60), s = Math.floor(t % 60)
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

/** 回傳整體警戒等級（給主警報用）與觸發警告的 key 集合 */
function renderReadouts(s: GameState): { level: Level; keys: string[] } {
  const dtg = s.elapsed - prevElapsed
  prevElapsed = s.elapsed
  let worst: Level = ''
  const keys: string[] = []

  const navOn = s.devices.navComp.on
  if (navOn) lastKnownDev = s.dev
  if (!navOn) { if (blindSince < 0) blindSince = s.elapsed } else blindSince = -1

  for (const d of ROWS) {
    const el = rowEls[d.key]
    const v = valueOf(s, d.key)
    if (dtg > 0 && prev[d.key] !== undefined) {
      const r = (v - prev[d.key]) / dtg
      rate[d.key] = rate[d.key] === undefined ? r : rate[d.key] * 0.94 + r * 0.06
    }
    prev[d.key] = v
    const r = rate[d.key] ?? 0
    const blind = d.key === 'dev' && !navOn

    // 等級
    let lvl: Level = ''
    const inWarn = d.dir === 1 ? v >= d.warning : v <= d.warning
    const inCaution = d.dir === 1 ? v >= d.caution : v <= d.caution
    const toward = d.dir === 1 ? r > 0.0001 : r < -0.0001
    const ttl = toward ? Math.abs((d.lethal - v) / r) : Infinity
    if (!blind) {
      if (inWarn || ttl < 25) lvl = 'warning'
      else if (inCaution || ttl < 70) lvl = 'caution'
    } else {
      const blindFor = s.elapsed - blindSince
      const hi = lastKnownDev + blindFor * (s.temp < TEMP_FROST ? DEV_DRIFT_MAX_COLD : DEV_DRIFT_MAX) * s.mods.driftMul
      lvl = hi >= d.warning ? 'warning' : hi >= d.caution || blindFor > 6 ? 'caution' : ''
    }
    el.root.className = `ro ${lvl}${d.key === 'temp' && v < TEMP_FROST && !lvl ? ' cold' : ''}${blind ? ' blind' : ''}`
    if (lvl === 'warning') { worst = 'warning'; keys.push(d.key) } else if (lvl === 'caution' && worst === '') worst = 'caution'

    if (blind) {
      const blindFor = s.elapsed - blindSince
      const maxRate = (s.temp < TEMP_FROST ? DEV_DRIFT_MAX_COLD : DEV_DRIFT_MAX) * s.mods.driftMul
      const lo = lastKnownDev, hi = Math.min(100, lastKnownDev + blindFor * maxRate)
      el.val.textContent = 'ERR'
      el.fill.style.width = `${pct(d, lo)}%`
      el.range.hidden = false
      el.range.style.left = `${pct(d, lo)}%`
      el.range.style.width = `${Math.max(0, pct(d, hi) - pct(d, lo))}%`
      el.trend.textContent = `盲飛 ${blindFor.toFixed(0)}s`
      el.ttl.textContent = `估 ${lo.toFixed(0)}–${hi.toFixed(0)}%`
    } else {
      el.range.hidden = true
      el.val.textContent = d.fmt(v)
      el.fill.style.width = `${pct(d, v)}%`
      const arrow = Math.abs(r) < (d.key === 'co2' ? 0.5 : 0.004) ? '■ 穩定' : `${r > 0 ? '▲' : '▼'} ${d.rateFmt(Math.abs(r))}`
      el.trend.textContent = arrow
      el.ttl.textContent = ttl < 180 ? `≈${fmtSec(ttl)} 致命` : (d.key === 'dev' && navOn ? '修正中' : '')
    }
    if (d.key === 'o2' && el.extra) {
      const tanks = s.liqO2 / LIQO2_PER_TANK
      el.extra.innerHTML = 'LIQ ' + [0, 1, 2].map(i => {
        const f = Math.max(0, Math.min(1, tanks - i))
        return f >= 1 ? '<i class="full"></i>' : f > 0 ? `<i class="part" style="--p:${(f * 100).toFixed(0)}%"></i>` : '<i></i>'
      }).join('')
      el.extra.className = 'liq'
    }
  }
  return { level: worst, keys }
}

// ════════════════ 軌道圖 ════════════════
let trajPath: SVGPathElement, trajDone: SVGPathElement, craft: SVGElement
let trajLen = 0, periLen = 0
const P_PERI = (MISSION_EVENTS.find(e => e.id === 'peri')!.met - MET_START) / ETA_INIT
const evDots: { el: SVGElement; id: string }[] = []

function progressToLen(p: number): number {
  p = Math.max(0, Math.min(1, p))
  return p < P_PERI ? (p / P_PERI) * periLen : periLen + ((p - P_PERI) / (1 - P_PERI)) * (trajLen - periLen)
}

function buildTrajectory(): void {
  const root = $('#traj') as unknown as SVGSVGElement
  root.innerHTML = ''
  const defs = svg('defs', {}, root)
  const eg = svg('radialGradient', { id: 'gE', cx: '35%', cy: '35%' }, defs)
  svg('stop', { offset: '0%', 'stop-color': '#8fd0ff' }, eg); svg('stop', { offset: '100%', 'stop-color': '#1a4f9a' }, eg)
  const mg = svg('radialGradient', { id: 'gM', cx: '35%', cy: '35%' }, defs)
  svg('stop', { offset: '0%', 'stop-color': '#e5e5e5' }, mg); svg('stop', { offset: '100%', 'stop-color': '#6b6b6b' }, mg)

  svg('path', { d: 'M 56 68 C 110 30, 190 36, 250 44', class: 'orbit-path', opacity: 0.4 }, root)
  const d = 'M 250 44 C 300 40, 350 48, 366 70 C 378 88, 358 104, 338 98 C 290 88, 200 128, 120 118 C 84 113, 64 100, 54 88'
  trajPath = svg('path', { d, class: 'orbit-path' }, root) as SVGPathElement
  trajDone = svg('path', { d, class: 'orbit-done' }, root) as SVGPathElement
  svg('circle', { cx: 40, cy: 78, r: 16, fill: 'url(#gE)' }, root)
  svg('circle', { cx: 345, cy: 76, r: 9, fill: 'url(#gM)' }, root)
  const tE = svg('text', { x: 40, y: 108, 'text-anchor': 'middle', class: 'ev-lbl' }, root); tE.textContent = '地球'
  const tM = svg('text', { x: 345, y: 62, 'text-anchor': 'middle', class: 'ev-lbl' }, root); tM.textContent = '月球'

  trajLen = trajPath.getTotalLength()
  // 找最接近月球背面的點當近月點
  let best = 0, bestD = 1e9
  for (let l = 0; l < trajLen; l += 1) {
    const pt = trajPath.getPointAtLength(l)
    const dd = (pt.x - 372) ** 2 + (pt.y - 82) ** 2
    if (dd < bestD) { bestD = dd; best = l }
  }
  periLen = best
  trajDone.style.strokeDasharray = `${trajLen}`
  trajDone.style.strokeDashoffset = `${trajLen}`

  evDots.length = 0
  for (const ev of MISSION_EVENTS) {
    if (ev.id === 'entry') continue
    const p = (ev.met - MET_START) / ETA_INIT
    const pt = trajPath.getPointAtLength(progressToLen(p))
    const dot = svg('circle', { cx: pt.x, cy: pt.y, r: ev.burn ? 4.5 : 3, class: `ev-dot${ev.burn ? ' burn' : ''}` }, root)
    const title = svg('title', {}, dot); title.textContent = ev.title
    evDots.push({ el: dot, id: ev.id })
  }
  craft = svg('path', { d: 'M -5 -3 L 6 0 L -5 3 Z', class: 'craft' }, root)
}

function renderTrajectory(s: GameState, p: number): void {
  const len = progressToLen(p)
  trajDone.style.strokeDashoffset = `${trajLen - len}`
  const pt = trajPath.getPointAtLength(len)
  const pt2 = trajPath.getPointAtLength(Math.min(trajLen, len + 2))
  const ang = Math.atan2(pt2.y - pt.y, pt2.x - pt.x) * 180 / Math.PI
  craft.setAttribute('transform', `translate(${pt.x} ${pt.y}) rotate(${ang})`)
  for (const d of evDots) {
    const ok = s.log.some(l => l.id === d.id && (l.kind === 'burn-ok' || l.kind === 'event'))
    const fail = s.log.some(l => l.id === d.id && l.kind === 'burn-fail')
    d.el.classList.toggle('done', ok)
    d.el.classList.toggle('fail', fail)
  }
  $('#traj-pct').textContent = `${Math.floor(p * 100)}%`
}

// ════════════════ 安培表 ════════════════
const A_MAX = 15
let needle: SVGLineElement, ghost: SVGLineElement, overArc: SVGPathElement
let needleV = 0
let previewDelta: number | null = null
function angleOf(v: number): number { return (200 - (v / A_MAX) * 220) * Math.PI / 180 }
function ptAt(v: number, r: number): [number, number] { const a = angleOf(v); return [100 + r * Math.cos(a), 104 - r * Math.sin(a)] }
function arcPath(v0: number, v1: number, r: number): string {
  const [x0, y0] = ptAt(v0, r), [x1, y1] = ptAt(v1, r)
  const large = ((v1 - v0) / A_MAX) * 220 > 180 ? 1 : 0
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

function buildGauge(): void {
  const g = $('#amp-gauge') as unknown as SVGSVGElement
  g.innerHTML = ''
  svg('path', { d: arcPath(0, A_MAX, 86), stroke: '#0b0f13', 'stroke-width': 22, fill: 'none' }, g)
  svg('path', { d: arcPath(0, 8, 84), stroke: 'rgba(125,255,160,0.25)', 'stroke-width': 6, fill: 'none' }, g)
  svg('path', { d: arcPath(8, 10, 84), stroke: 'rgba(255,181,71,0.6)', 'stroke-width': 6, fill: 'none' }, g)
  svg('path', { d: arcPath(10, A_MAX, 84), stroke: '#ff4a3d', 'stroke-width': 6, fill: 'none', filter: 'drop-shadow(0 0 4px #ff4a3d)' }, g)
  overArc = svg('path', { d: arcPath(10, 10.01, 94), stroke: '#ff4a3d', 'stroke-width': 3, fill: 'none' }, g) as SVGPathElement
  for (let v = 0; v <= A_MAX; v++) {
    const major = v % 5 === 0
    const [x0, y0] = ptAt(v, major ? 70 : 74), [x1, y1] = ptAt(v, 80)
    svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: v > 10 ? '#ff6a5c' : '#9aa5b0', 'stroke-width': major ? 2 : 1 }, g)
    if (major) {
      const [tx, ty] = ptAt(v, 58)
      const t = svg('text', { x: tx, y: ty + 4, 'text-anchor': 'middle', fill: '#9aa5b0', 'font-size': 11, 'font-family': 'Share Tech Mono' }, g)
      t.textContent = String(v)
    }
  }
  const t10 = svg('text', { x: ptAt(10, 58)[0], y: ptAt(10, 58)[1] + 4, 'text-anchor': 'middle', fill: '#ff6a5c', 'font-size': 11, 'font-family': 'Share Tech Mono' }, g)
  t10.textContent = '10'
  const lbl = svg('text', { x: 100, y: 84, 'text-anchor': 'middle', fill: '#4a5562', 'font-size': 10, 'font-family': 'Share Tech Mono', 'letter-spacing': 2 }, g)
  lbl.textContent = 'AMPS'
  ghost = svg('line', { x1: 100, y1: 104, x2: 100, y2: 30, stroke: '#59d4ff', 'stroke-width': 2, 'stroke-dasharray': '3 3', opacity: 0 }, g) as SVGLineElement
  needle = svg('line', { x1: 100, y1: 104, x2: 100, y2: 30, stroke: '#ffe9d6', 'stroke-width': 3, 'stroke-linecap': 'round', filter: 'drop-shadow(0 0 3px rgba(255,200,150,0.8))' }, g) as SVGLineElement
  svg('circle', { cx: 100, cy: 104, r: 7, fill: '#2a323c', stroke: '#6b7682', 'stroke-width': 1.5 }, g)
}

function setNeedle(el: SVGLineElement, v: number): void {
  const [x, y] = ptAt(Math.max(-0.3, Math.min(A_MAX + 0.3, v)), 76)
  el.setAttribute('x2', String(x)); el.setAttribute('y2', String(y))
}

export function setAmpPreview(delta: number | null): void { previewDelta = delta }

function renderGauge(s: GameState, amp: number, dtw: number): void {
  needleV += (amp - needleV) * Math.min(1, dtw * 12)
  const jitter = amp > AMP_REDLINE ? (Math.random() - 0.5) * 0.35 : 0
  setNeedle(needle, needleV + jitter)
  if (previewDelta !== null && !s.brownout) {
    setNeedle(ghost, amp + previewDelta); ghost.setAttribute('opacity', '0.9')
  } else ghost.setAttribute('opacity', '0')
  const over = s.ampOverRedSeconds / BROWNOUT_SECONDS
  overArc.setAttribute('d', arcPath(10, 10 + Math.max(0.01, over * 5), 94))
  $('#amp-val').textContent = String(amp)
  const wrap = $('.amp-wrap')
  wrap.classList.toggle('over', amp > AMP_REDLINE)
  wrap.classList.toggle('near', amp > 8 && amp <= AMP_REDLINE)
}

// ════════════════ 開關/按鈕 ════════════════
const swEls: Record<DeviceId, HTMLElement> = {} as Record<DeviceId, HTMLElement>

function renderSwitches(s: GameState): void {
  for (const id of ['heater', 'co2Filter', 'navComp'] as DeviceId[]) {
    const el = swEls[id]
    const d = s.devices[id]
    const locked = s.elapsed < d.lockUntil
    el.classList.toggle('on', d.on)
    el.classList.toggle('locked', locked)
    el.classList.toggle('degraded', d.degraded)
    el.querySelector('.toggle')!.setAttribute('aria-pressed', String(d.on))
    const st = el.querySelector('.sw-state')!
    st.textContent = s.brownout ? '斷電' : locked ? `過熱 ${Math.ceil(d.lockUntil - s.elapsed)}s` : d.on ? 'ON' : 'OFF'
    if (id !== 'navComp') {
      const lim = OVERHEAT_LIMIT[id] * s.mods.overheatMul
      const r = Math.min(1, locked ? (d.lockUntil - s.elapsed) / 5 : d.heat / lim)
      const fill = el.querySelector('.heat-fill') as HTMLElement
      fill.style.width = `${r * 100}%`
      el.querySelector('.heat')!.classList.toggle('hot', r > 0.75 || locked)
    }
  }

  // 放氧閥
  const valve = $('#valve') as HTMLButtonElement
  valve.disabled = s.liqO2 <= 0 || s.brownout
  valve.classList.toggle('held', s.o2Releasing)
  $('.valve-txt').textContent = s.liqO2 <= 0 ? '耗盡' : s.o2Releasing ? '放氧中' : '按住'
  const tanks = document.querySelectorAll<HTMLElement>('#tanks .tank')
  tanks.forEach((t, i) => {
    const f = Math.max(0, Math.min(1, s.liqO2 / LIQO2_PER_TANK - i))
    ;(t.firstElementChild as HTMLElement).style.height = `${f * 100}%`
    t.classList.toggle('empty', f <= 0)
  })

  // 點火
  const ig = $('#ignite') as HTMLButtonElement
  const b = s.burn
  const ok = !!b && s.devices.navComp.on && s.dev <= b.tol
  ig.disabled = !b || s.brownout
  ig.classList.toggle('armed', !!b && !s.burning)
  ig.classList.toggle('firing', s.burning && ok)
  ig.classList.toggle('blocked', s.burning && !ok)
  $('.ignite-txt').textContent = !b ? '待命' : s.burning ? (ok ? '點火中' : '條件不足') : '按住'
  const ring = $('#ignite-ring') as unknown as SVGCircleElement
  ring.style.strokeDashoffset = String(276.5 * (1 - (b ? b.progress / b.hold : 0)))
  $('#ignite-hint').textContent = b ? `${Math.max(0, b.until - s.elapsed).toFixed(0)}s 內完成` : '等待點火視窗'

  // 斷路器
  const br = $('#breaker')
  br.classList.toggle('tripped', s.brownout)
  $('.breaker-wrap').classList.toggle('tripped', s.brownout)
  $('#breaker-state').textContent = s.brownout ? '跳脫！點我復電' : '正常'

  // 點火橫幅（CRT 內）
  const banner = $('#burn-banner')
  if (b) {
    const ev = MISSION_EVENTS.find(e => e.id === b.id)!
    const amp = computeAmp(s) + (s.burning ? 0 : AMP_ENGINE)
    const c = (cond: boolean, t: string) => `<span class="${cond ? 'ok' : 'no'}">${cond ? '✔' : '✖'} ${t}</span>`
    banner.hidden = false
    banner.innerHTML = `
      <div class="bb-top"><span>▲ ${ev.title}</span><span>剩 ${Math.max(0, b.until - s.elapsed).toFixed(1)}s</span></div>
      <div class="bb-checks">${c(s.devices.navComp.on, '導航 ON')}${c(s.dev <= b.tol, `DEV ≤ ${b.tol}%`)}${c(amp <= AMP_REDLINE, `點火後 ${amp}A ≤ 10A`)}<span>按住 F：${b.progress.toFixed(1)}/${b.hold}s</span></div>
      <div class="bb-bar"><i style="width:calc(${(b.progress / b.hold) * 100}% - 2px)"></i></div>`
  } else banner.hidden = true
}

// ════════════════ 頂列與其他 ════════════════
function fmtETA(sec: number): string {
  const t = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

let alarmKeys = ''
let alarmSilenced = false
export function silenceAlarm(): void { alarmSilenced = true }
let lastWall = performance.now()

export type HudResult = { alarm: boolean; alarmSound: boolean; progress: number }

export function renderHud(s: GameState): HudResult {
  const now = performance.now()
  const dtw = Math.min(0.1, (now - lastWall) / 1000)
  lastWall = now
  const amp = computeAmp(s)
  const progress = Math.max(0, Math.min(1, (computeMET(s) - MET_START) / ETA_INIT))

  $('#met').textContent = formatMET(computeMET(s))
  const eta = $('#eta')
  eta.textContent = fmtETA(s.eta)
  eta.classList.toggle('frozen', !s.devices.navComp.on)

  const { level, keys } = renderReadouts(s)
  if (amp > AMP_REDLINE) keys.push('amp')
  if (s.brownout) keys.push('brownout')
  const k = keys.join(',')
  if (k !== alarmKeys) { alarmKeys = k; alarmSilenced = false }
  const alarm = keys.length > 0
  const mode = $('#crt-mode')
  mode.textContent = s.brownout ? 'BUS FAULT' : level === 'warning' ? 'WARNING' : level === 'caution' ? 'CAUTION' : 'NOMINAL'
  mode.className = `crt-mode ${s.brownout ? 'warning' : level}`
  const ma = $('#master-alarm')
  ma.classList.toggle('on', alarm)
  ma.classList.toggle('silenced', alarmSilenced)
  $('#fx-alarm').classList.toggle('on', alarm && !alarmSilenced)

  renderSwitches(s)
  renderGauge(s, amp, dtw)
  renderTrajectory(s, progress)
  $('#view-tag').textContent = viewLabel(progress)

  const next = MISSION_EVENTS[s.nextEvent]
  $('#checklist').innerHTML = `<h4>NEXT MILESTONE · 下一個里程碑</h4><div class="next">${next ? `${next.burn ? '<b>🔥 點火</b>　' : ''}${next.title}　<span style="color:var(--ink-faint)">MET ${formatMET(next.met).slice(0, 6)}</span>` : '濺落 · 太平洋'}</div>`

  return { alarm, alarmSound: alarm && !alarmSilenced, progress }
}

export function resetHud(): void {
  for (const k in rate) delete rate[k]
  for (const k in prev) delete prev[k]
  prevElapsed = 0; lastKnownDev = 0; blindSince = -1
  alarmKeys = ''; alarmSilenced = false; needleV = 0
}

export function initHud(): void {
  buildReadouts()
  buildTrajectory()
  buildGauge()
  for (const el of document.querySelectorAll<HTMLElement>('.sw')) swEls[el.dataset.dev as DeviceId] = el
}

export const AMP_OF: Record<DeviceId, number> = { heater: AMP.heater, co2Filter: AMP.co2Filter, navComp: AMP.navComp }
