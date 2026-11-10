/**
 * 背景音樂 — 從 public/audio/ 載入 MP3，無限循環。
 * 瀏覽器可能阻擋自動播放，會在首次點擊／按鍵後開始。
 */

const BGM_PATH = `${import.meta.env.BASE_URL}audio/bgm.mp3`
const BGM_VOLUME = 0.45

let audio: HTMLAudioElement | null = null
let started = false
let unlockBound = false

function tryPlay(): void {
  if (!audio || started) return
  audio.play()
    .then(() => { started = true; removeUnlock() })
    .catch(() => { /* 等待使用者手勢 */ })
}

function removeUnlock(): void {
  if (!unlockBound) return
  unlockBound = false
  document.removeEventListener('pointerdown', tryPlay)
  document.removeEventListener('keydown', tryPlay)
}

function bindUnlock(): void {
  if (unlockBound) return
  unlockBound = true
  document.addEventListener('pointerdown', tryPlay, { once: false })
  document.addEventListener('keydown', tryPlay, { once: false })
}

/** 初始化並嘗試播放背景音樂 */
export function initBgm(path = BGM_PATH, volume = BGM_VOLUME): void {
  if (audio) return

  audio = new Audio(path)
  audio.loop = true
  audio.volume = volume
  audio.preload = 'auto'

  audio.addEventListener('error', () => {
    console.warn(`[bgm] 找不到或無法播放：${path}（請將 MP3 放入 public/audio/）`)
  })

  tryPlay()
  bindUnlock()
}

export function setBgmVolume(v: number): void {
  if (audio) audio.volume = Math.max(0, Math.min(1, v))
}

export function pauseBgm(): void {
  audio?.pause()
}

export function resumeBgm(): void {
  tryPlay()
}
