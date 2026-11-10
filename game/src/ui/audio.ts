/**
 * 音效：全部用 WebAudio 即時合成（不需要音檔），外加既有 BGM。
 * - 開關喀噠、斷路器、爆炸、跳電悶響
 * - 電流嗡鳴（隨 AMP 變大，近紅線加入爆裂雜訊）
 * - 放氧嘶嘶聲、引擎點火低頻轟鳴
 * - 主警報雙音、低溫/缺氧心跳
 * - Quindar tones：阿波羅通訊真實使用的 2525 Hz / 2475 Hz 提示音
 */

let ctx: AudioContext | null = null
let master: GainNode
let sfxBus: GainNode
let muted = false
let noiseBuf: AudioBuffer

let humOsc: OscillatorNode, humOsc2: OscillatorNode, humGain: GainNode, crackleGain: GainNode
let hissGain: GainNode, rumbleGain: GainNode
let alarmGain: GainNode
let alarmTimer: number | null = null
let heartTimer: number | null = null
let heartRate = 0

const bgm = new Audio(`${import.meta.env.BASE_URL}audio/bgm.mp3`)
bgm.loop = true
bgm.volume = 0.28
bgm.preload = 'auto'

function noiseSource(): AudioBufferSourceNode {
  const src = ctx!.createBufferSource()
  src.buffer = noiseBuf
  src.loop = true
  return src
}

export function initAudio(): void {
  if (ctx) { void ctx.resume(); return }
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!AC) return
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = muted ? 0 : 0.9
  master.connect(ctx.destination)
  sfxBus = ctx.createGain()
  sfxBus.gain.value = 1
  sfxBus.connect(master)

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1

  // 電流嗡鳴：60Hz 基頻 + 120Hz 泛音（電源哼聲）
  humGain = ctx.createGain(); humGain.gain.value = 0
  const humFilter = ctx.createBiquadFilter(); humFilter.type = 'lowpass'; humFilter.frequency.value = 600
  humOsc = ctx.createOscillator(); humOsc.type = 'sawtooth'; humOsc.frequency.value = 60
  humOsc2 = ctx.createOscillator(); humOsc2.type = 'square'; humOsc2.frequency.value = 120
  const h2g = ctx.createGain(); h2g.gain.value = 0.3
  humOsc.connect(humFilter); humOsc2.connect(h2g).connect(humFilter)
  humFilter.connect(humGain).connect(sfxBus)
  humOsc.start(); humOsc2.start()

  // 近紅線的電弧爆裂
  crackleGain = ctx.createGain(); crackleGain.gain.value = 0
  const crk = noiseSource()
  const crkF = ctx.createBiquadFilter(); crkF.type = 'highpass'; crkF.frequency.value = 3000
  const crkLfo = ctx.createOscillator(); crkLfo.type = 'square'; crkLfo.frequency.value = 13
  const crkLfoG = ctx.createGain(); crkLfoG.gain.value = 0.5
  const crkAmp = ctx.createGain(); crkAmp.gain.value = 0.5
  crkLfo.connect(crkLfoG).connect(crkAmp.gain)
  crk.connect(crkF).connect(crkAmp).connect(crackleGain).connect(sfxBus)
  crk.start(); crkLfo.start()

  // 放氧嘶嘶
  hissGain = ctx.createGain(); hissGain.gain.value = 0
  const hiss = noiseSource()
  const hissF = ctx.createBiquadFilter(); hissF.type = 'bandpass'; hissF.frequency.value = 5200; hissF.Q.value = 0.7
  hiss.connect(hissF).connect(hissGain).connect(sfxBus); hiss.start()

  // 引擎轟鳴
  rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0
  const rum = noiseSource()
  const rumF = ctx.createBiquadFilter(); rumF.type = 'lowpass'; rumF.frequency.value = 160
  rum.connect(rumF).connect(rumbleGain).connect(sfxBus); rum.start()

  alarmGain = ctx.createGain(); alarmGain.gain.value = 0.16
  alarmGain.connect(sfxBus)
}

export function playBgm(): void { if (!muted) void bgm.play().catch(() => {}) }
export function stopBgm(): void { bgm.pause() }

export function setMuted(m: boolean): void {
  muted = m
  if (ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05)
  if (m) bgm.pause(); else void bgm.play().catch(() => {})
}
export function isMuted(): boolean { return muted }

function env(g: GainNode, t: number, peak: number, a: number, d: number): void {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + a)
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, when = 0): void {
  if (!ctx) return
  const t = ctx.currentTime + when
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq
  const g = ctx.createGain()
  env(g, t, vol, 0.005, dur)
  o.connect(g).connect(sfxBus)
  o.start(t); o.stop(t + dur + 0.05)
}

function noiseBurst(dur: number, vol: number, filterType: BiquadFilterType, freq: number, when = 0): void {
  if (!ctx) return
  const t = ctx.currentTime + when
  const src = noiseSource()
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq
  const g = ctx.createGain()
  env(g, t, vol, 0.004, dur)
  src.connect(f).connect(g).connect(sfxBus)
  src.start(t); src.stop(t + dur + 0.1)
}

/** 金屬撥動開關 */
export function sfxClick(on: boolean): void {
  noiseBurst(0.03, 0.5, 'bandpass', on ? 3800 : 2600)
  tone(on ? 1800 : 1200, 0.03, 'square', 0.05)
  noiseBurst(0.06, 0.18, 'lowpass', 400, 0.01)
}
export function sfxDenied(): void { tone(180, 0.12, 'square', 0.12); tone(140, 0.14, 'square', 0.1, 0.1) }
export function sfxBreaker(): void { noiseBurst(0.05, 0.7, 'bandpass', 1500); tone(90, 0.25, 'sine', 0.4, 0.02); tone(220, 0.5, 'sawtooth', 0.05, 0.2) }

/** 跳電：重擊 + 全場靜音 */
export function sfxBrownout(): void {
  if (!ctx) return
  noiseBurst(0.4, 0.9, 'lowpass', 300)
  tone(55, 0.8, 'sine', 0.7)
  humGain.gain.setTargetAtTime(0, ctx.currentTime, 0.01)
}

/** 爆炸（開場） */
export function sfxExplosion(): void {
  if (!ctx) return
  noiseBurst(2.2, 1.0, 'lowpass', 900)
  noiseBurst(0.3, 0.8, 'bandpass', 2000)
  tone(42, 2.0, 'sine', 0.9)
}

/** Quindar tone：CAPCOM 開始說話 */
export function sfxQuindar(): void { tone(2525, 0.25, 'sine', 0.07) }
export function sfxGood(): void { tone(660, 0.12, 'triangle', 0.14); tone(880, 0.12, 'triangle', 0.14, 0.12); tone(1320, 0.3, 'triangle', 0.12, 0.24) }
export function sfxBad(): void { tone(300, 0.25, 'sawtooth', 0.12); tone(200, 0.4, 'sawtooth', 0.12, 0.2) }
export function sfxType(): void { noiseBurst(0.015, 0.12, 'highpass', 4000) }
export function sfxStatic(): void { noiseBurst(0.6, 0.18, 'bandpass', 1800) }
export function sfxWin(): void {
  [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.6, 'triangle', 0.16, i * 0.18))
}

/** 每幀更新連續音 */
export function updateAmbience(o: {
  amp: number; overRed: boolean; o2Releasing: boolean; burning: boolean; brownout: boolean; running: boolean
}): void {
  if (!ctx) return
  const t = ctx.currentTime
  const live = o.running && !o.brownout
  const humTarget = live ? Math.min(0.11, 0.01 + o.amp * 0.007) : 0
  humGain.gain.setTargetAtTime(humTarget, t, 0.08)
  humOsc.frequency.setTargetAtTime(60 + o.amp * 1.5, t, 0.2)
  crackleGain.gain.setTargetAtTime(live && o.amp >= 9 ? (o.overRed ? 0.35 : 0.08) : 0, t, 0.05)
  hissGain.gain.setTargetAtTime(live && o.o2Releasing ? 0.22 : 0, t, 0.05)
  rumbleGain.gain.setTargetAtTime(live && o.burning ? 0.9 : 0, t, 0.08)
}

/** 主警報：雙音循環 */
export function setAlarm(on: boolean): void {
  if (!ctx) return
  if (on && alarmTimer === null) {
    const beep = () => {
      if (!ctx) return
      const t = ctx.currentTime
      for (const [f, dt] of [[1400, 0], [1000, 0.18]] as const) {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f
        const g = ctx.createGain(); env(g, t + dt, 0.5, 0.005, 0.15)
        o.connect(g).connect(alarmGain); o.start(t + dt); o.stop(t + dt + 0.2)
      }
    }
    beep()
    alarmTimer = window.setInterval(beep, 900)
  } else if (!on && alarmTimer !== null) {
    clearInterval(alarmTimer); alarmTimer = null
  }
}

/** 心跳：bpm=0 關閉 */
export function setHeartbeat(bpm: number): void {
  if (!ctx) return
  if (Math.abs(bpm - heartRate) < 4 && (bpm === 0) === (heartRate === 0)) return
  heartRate = bpm
  if (heartTimer !== null) { clearTimeout(heartTimer); heartTimer = null }
  if (bpm <= 0) return
  const beat = () => {
    tone(58, 0.14, 'sine', 0.55); tone(52, 0.16, 'sine', 0.4, 0.18)
    heartTimer = window.setTimeout(beat, 60000 / heartRate)
  }
  beat()
}

export function stopAll(): void {
  setAlarm(false); setHeartbeat(0)
  updateAmbience({ amp: 0, overRed: false, o2Releasing: false, burning: false, brownout: false, running: false })
}
