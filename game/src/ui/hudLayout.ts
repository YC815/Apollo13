import type { CameraMode } from './scene3d'

/** 僅更新 body 樣式類別（艙內時標題淡化）；HUD 一律使用底部儀表板 */
export function setHudLayout(mode: CameraMode): void {
  const interior = mode === 'interior'
  document.body.classList.toggle('mode-interior', interior)
  document.body.classList.toggle('mode-exterior', !interior)
}

/** 套用儀表板貼皮到 HTML 面板與 CSS 變數 */
export function applyCockpitTextures(opts: {
  instrumentPanel: string | null
  button: string | null
  gaugeFace: string | null
}): void {
  const panel = document.getElementById('cockpit-panel')
  if (panel && opts.instrumentPanel) {
    panel.style.setProperty('--panel-tex', `url(${opts.instrumentPanel})`)
  }
  if (opts.button) {
    document.documentElement.style.setProperty('--btn-tex', `url(${opts.button})`)
  }
  if (opts.gaugeFace) {
    document.documentElement.style.setProperty('--gauge-tex', `url(${opts.gaugeFace})`)
  }
}
