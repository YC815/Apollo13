/**
 * 全畫面狀態特效（純視覺，讀 GameState，不改遊戲）：
 * - CO2 > 5000：四周發黑；> 8000：畫面暈眩搖晃＋模糊（取代舊版不穩定的游標漂移）
 * - TEMP < 10：程序化冰晶從邊緣長出；< 5：冰霜爬上 CRT 遮住數字
 * - 跳電：CRT 關機動畫、艙內斷電
 */
import type { GameState } from '../game/state'
import { CO2_VIGNETTE, CO2_LETHAL, CO2_CURSOR, TEMP_FROST, TEMP_FROST_HEAVY } from '../game/constants'

let frostURL = ''

/** 用 canvas 畫一張「從四邊往內長」的冰晶貼圖（只畫一次） */
function makeFrost(w = 1280, h = 800): string {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.65)
  grd.addColorStop(0, 'rgba(200,230,255,0)')
  grd.addColorStop(1, 'rgba(200,230,255,0.35)')
  g.fillStyle = grd; g.fillRect(0, 0, w, h)

  g.lineCap = 'round'
  // 羽狀冰晶（dendrite）：主幹 + 兩側 60° 細羽，越往內越細越淡
  const feather = (x: number, y: number, ang: number, len: number, w0: number, depth: number) => {
    const steps = Math.max(3, Math.floor(len / 6))
    let px = x, py = y
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const nx = x + Math.cos(ang) * len * t, ny = y + Math.sin(ang) * len * t
      g.strokeStyle = `rgba(230,245,255,${0.32 * (1 - t * 0.7)})`
      g.lineWidth = w0 * (1 - t * 0.8)
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke()
      if (depth > 0 && i % 2 === 0) {
        const bl = len * (1 - t) * (0.28 + Math.random() * 0.12)
        if (bl > 3) {
          feather(nx, ny, ang + Math.PI / 3, bl, w0 * 0.55, depth - 1)
          feather(nx, ny, ang - Math.PI / 3, bl, w0 * 0.55, depth - 1)
        }
      }
      px = nx; py = ny
    }
  }
  const seeds = 140
  for (let i = 0; i < seeds; i++) {
    const edge = i % 4
    let x = 0, y = 0, ang = 0
    if (edge === 0) { x = Math.random() * w; y = 0; ang = Math.PI / 2 }
    if (edge === 1) { x = Math.random() * w; y = h; ang = -Math.PI / 2 }
    if (edge === 2) { x = 0; y = Math.random() * h; ang = 0 }
    if (edge === 3) { x = w; y = Math.random() * h; ang = Math.PI }
    // 角落更密更長
    const cx = Math.min(x, w - x) / w, cy = Math.min(y, h - y) / h
    const corner = 1 - Math.min(1, (cx + cy) * 3)
    feather(x, y, ang + (Math.random() - 0.5) * 1.2, 30 + Math.random() * 70 + corner * 120, 1.6, 2)
  }
  // 細碎霜點
  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * w, y = Math.random() * h
    const dx = Math.min(x, w - x) / w, dy = Math.min(y, h - y) / h
    if (Math.random() > 1 - Math.min(dx, dy) * 5) continue
    g.fillStyle = `rgba(235,248,255,${Math.random() * 0.5})`
    g.fillRect(x, y, 1.5, 1.5)
  }
  return c.toDataURL('image/png')
}

let fxCo2: HTMLElement, fxFrost: HTMLElement, cabin: HTMLElement, crtFrost: HTMLElement, portFrost: HTMLElement

export function initEffects(): void {
  frostURL = makeFrost()
  fxCo2 = document.getElementById('fx-co2')!
  fxFrost = document.getElementById('fx-frost')!
  cabin = document.getElementById('cabin')!
  crtFrost = document.querySelector('.crt-frost') as HTMLElement
  portFrost = document.querySelector('.porthole-frost') as HTMLElement
  for (const el of [fxFrost, crtFrost, portFrost]) el.style.backgroundImage = `url(${frostURL})`
}

export function updateEffects(s: GameState): void {
  const co2t = s.co2 <= CO2_VIGNETTE ? 0 : Math.min(1, (s.co2 - CO2_VIGNETTE) / (CO2_LETHAL - CO2_VIGNETTE))
  fxCo2.style.opacity = co2t.toFixed(3)
  cabin.classList.toggle('is-dizzy', s.co2 > CO2_CURSOR && s.phase === 'playing')

  const light = s.temp >= TEMP_FROST ? 0 : Math.min(1, (TEMP_FROST - s.temp) / (TEMP_FROST - TEMP_FROST_HEAVY))
  const heavy = s.temp >= TEMP_FROST_HEAVY ? 0 : Math.min(1, (TEMP_FROST_HEAVY - s.temp) / TEMP_FROST_HEAVY)
  fxFrost.style.opacity = (light * 0.6 + heavy * 0.4).toFixed(3)
  portFrost.style.opacity = (light * 0.8).toFixed(3)
  crtFrost.style.opacity = (heavy * 0.95).toFixed(3)
}

export function clearEffects(): void {
  fxCo2.style.opacity = '0'; fxFrost.style.opacity = '0'
  portFrost.style.opacity = '0'; crtFrost.style.opacity = '0'
  cabin.classList.remove('is-dizzy', 'is-brownout')
}

export function shake(): void {
  cabin.classList.remove('is-shake')
  void cabin.offsetWidth
  cabin.classList.add('is-shake')
}

export function flash(): void {
  const f = document.getElementById('fx-flash')!
  f.classList.remove('go'); void f.offsetWidth; f.classList.add('go')
}
