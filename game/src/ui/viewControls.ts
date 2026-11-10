import { setCameraMode, getCameraMode, type CameraMode } from './scene3d'

export const VIEW_ID = {
  interior: 'view-interior',
  free:     'view-free',
  orbit:    'view-orbit',
} as const

function makeBtn(id: string, label: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.id = id
  el.textContent = label
  return el
}

function highlightActive(mode: CameraMode): void {
  const map: Record<CameraMode, string> = {
    interior: VIEW_ID.interior,
    free:     VIEW_ID.free,
    orbit:    VIEW_ID.orbit,
  }
  for (const id of Object.values(VIEW_ID)) {
    const el = document.getElementById(id) as HTMLButtonElement | null
    if (!el) continue
    el.classList.toggle('view-active', id === map[mode])
  }
}

function switchMode(mode: CameraMode): void {
  setCameraMode(mode)
  highlightActive(mode)
}

export function setupViewControls(): void {
  const row = document.getElementById('view-slot-cockpit')!

  const orbitBtn    = makeBtn(VIEW_ID.orbit,    '環繞 ORBIT')
  const interiorBtn = makeBtn(VIEW_ID.interior, '艙內 INTERIOR')
  const freeBtn     = makeBtn(VIEW_ID.free,     '自由 FREE')

  orbitBtn.addEventListener('click',    () => switchMode('orbit'))
  interiorBtn.addEventListener('click', () => switchMode('interior'))
  freeBtn.addEventListener('click',     () => switchMode('free'))

  row.append(orbitBtn, interiorBtn, freeBtn)
  highlightActive(getCameraMode())
}
