import type { DeviceId, Difficulty, GameState, LoseReason } from './game/state'
import { computeMET, computeAmp } from './game/state'
import { AMP, AMP_ENGINE, ETA_INIT, MET_START, TEMP_FROST } from './game/constants'
import { getState, newGame, setRunning, isRunning, tick, toggleDevice, setO2Held, setBurnHeld, doReset } from './game/loop'
import { initSpace, renderSpace } from './ui/space'
import { initHud, renderHud, resetHud, setAmpPreview, silenceAlarm } from './ui/hud'
import { initEffects, updateEffects, clearEffects, shake, flash } from './ui/effects'
import { initCapcom, resetCapcom, updateCapcom } from './ui/capcom'
import * as audio from './ui/audio'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

type Screen = 'title' | 'brief' | 'history' | 'intro' | 'pause' | 'end' | null
const SCREENS: Exclude<Screen, null>[] = ['title', 'brief', 'history', 'intro', 'pause', 'end']
let screen: Screen = 'title'
let briefReturn: Screen = 'title'
let difficulty: Difficulty = 'standard'
let lastBrownout = false
let introAbort: (() => void) | null = null

const store = {
  get(k: string): string | null { try { return localStorage.getItem('a13:' + k) } catch { return null } },
  set(k: string, v: string): void { try { localStorage.setItem('a13:' + k, v) } catch { /* 無痕模式 */ } },
}

function show(s: Screen): void {
  screen = s
  for (const id of SCREENS) $(`scr-${id}`).hidden = id !== s
}

// ════════════════ 遊戲流程 ════════════════
function startGame(): void {
  audio.initAudio()
  audio.stopAll()
  newGame(difficulty)
  resetHud()
  const firstTime = !store.get('played')
  resetCapcom(difficulty === 'training' || firstTime)
  store.set('played', '1')
  clearEffects()
  lastBrownout = false
  $('crt').parentElement!.classList.remove('off')
  show(null)
  setRunning(true)
  audio.playBgm()
}

function pause(): void {
  if (!isRunning()) return
  setRunning(false)
  audio.stopAll()
  show('pause')
}
function resume(): void {
  show(null)
  setRunning(true)
}
function toMenu(): void {
  setRunning(false)
  audio.stopAll()
  clearEffects()
  newGame(difficulty)
  resetHud()
  show('title')
  renderBest()
}

// ════════════════ 開場過場 ════════════════
const wait = (ms: number, signal: { aborted: boolean }) => new Promise<void>((res, rej) => {
  const t = setTimeout(() => signal.aborted ? rej(new Error('skip')) : res(), ms)
  if (signal.aborted) { clearTimeout(t); rej(new Error('skip')) }
})

async function playIntro(): Promise<void> {
  audio.initAudio()
  show('intro')
  const box = $('intro-text')
  box.innerHTML = ''
  const signal = { aborted: false }
  const done = new Promise<void>(res => { introAbort = () => { signal.aborted = true; res() } })

  const type = async (html: string, cls = '', speed = 28) => {
    const line = document.createElement('div')
    if (cls) line.className = cls
    box.appendChild(line)
    const cursor = '<span class="cursor"></span>'
    // 逐字（保留簡單 HTML 標籤）
    const tokens = html.match(/<[^>]+>|./gs) ?? []
    let acc = ''
    for (const t of tokens) {
      acc += t
      if (t.startsWith('<')) continue
      line.innerHTML = acc + cursor
      if (t.trim()) audio.sfxType()
      await wait(speed, signal)
    }
    line.innerHTML = acc
  }
  const run = async () => {
    await type('APR 13, 1970 · MET 55:46:00')
    await type('<span class="zh">電視直播剛結束。三名太空人準備關燈休息，明天就要登月。</span>', '', 22)
    await wait(700, signal)
    await type('CAPCOM: 13, WE\'D LIKE YOU TO STIR UP YOUR CRYO TANKS.', '', 22)
    await type('<span class="zh">（休士頓請求攪拌低溫氧氣槽——例行公事。）</span>', '', 18)
    await wait(900, signal)
    audio.sfxExplosion(); flash(); shake()
    box.innerHTML = ''
    await wait(600, signal)
    await type('MET 55:54:53', 'red', 40)
    await type('OXYGEN TANK 2 — EXPLOSION\nFUEL CELL 1, 2 — OFFLINE\nMAIN BUS B — UNDERVOLT', 'red', 18)
    await wait(600, signal)
    await type('"HOUSTON, WE\'VE HAD A PROBLEM."', 'amber', 45)
    await type('<span class="zh">—— Jack Swigert，MET 55:55:20</span>', '', 18)
    await wait(1200, signal)
    box.innerHTML = ''
    await type('SWITCHING TO LM AQUARIUS\nLIFEBOAT PROCEDURE INITIATED', 'amber', 26)
    await type('<span class="zh">服務艙的氧氣在漏，主電力全滅。三個人退進只為兩人、兩天設計的登月艙「水瓶座」。\n剩下的電力，由你分配。</span>', '', 20)
    await wait(1600, signal)
  }
  await Promise.race([run().catch(() => {}), done])
  signal.aborted = true
  introAbort = null
  startGame()
}

// ════════════════ 結算 ════════════════
const LOSE: Record<LoseReason, { kicker: string; title: string; desc: string; tip: string }> = {
  power: { kicker: 'MAIN BUS · 0%', title: '永遠漂流', desc: '電池耗盡，水瓶座失去所有動力，在地球與月球之間永遠漂流。', tip: '電力只降不升，跳電一次就扣 3%。看主電力的「致命倒數」，不需要的設備就關掉。' },
  oxygen: { kicker: 'O2 TANK · 0%', title: '窒息', desc: '艙內氧氣耗盡。三個人的呼吸，比預期更快吃光了空氣。', tip: '氧氣低於 30% 就按住放氧閥；液態氧共 30 秒，省著用。放完氧記得補暖氣，因為氣化會帶走熱量。' },
  co2: { kicker: 'CO2 · 10000 PPM', title: '二氧化碳中毒', desc: '呼出的 CO2 累積到致命濃度。真實歷史中，是地面用膠帶和塑膠袋做的「郵箱」救了他們。', tip: '別等到 CO2 變紅。濾罐開到熱量條快滿就關、散熱後再開，用暖氣補空檔。' },
  temp: { kicker: 'CABIN · 0°C', title: '失溫', desc: '艙溫跌破冰點。真實的水瓶座艙溫曾降到約 3°C，組員冷得整夜無法入睡。', tip: '暖氣和濾罐要「接力」——加上導航剛好不能同時開。冷的時候不要放氧，那會讓溫度暴跌。' },
  deviation: { kicker: 'DEV > 50%', title: '再入角度錯誤', desc: '軌道偏離太大，太空艙以錯誤角度撞進大氣層。', tip: '關掉導航就是盲飛：DEV 看不見但會一直漲，太冷時漲得更快。盲飛不要超過 10 秒。' },
}

const FACTS = [
  '阿波羅 13 號在月球背面時距離地球 400,171 公里，這個「人類最遠」的紀錄保持了五十多年。',
  '登月艙只為 2 人、45 小時設計，最後撐住 3 人近 90 小時。',
  '組員每天只喝約 6 盎司（180 ml）的水，Haise 因此腎臟感染、發高燒。',
  '電腦精度不夠時，Lovell 以地球晨昏線手動對準，完成 MCC-5 點火。',
  '這次任務被 NASA 稱為「成功的失敗」（a successful failure）。',
]

function score(s: GameState): { score: number; grade: string } {
  const mult = { training: 0.6, standard: 1, hard: 1.5 }[s.difficulty]
  if (s.phase !== 'win') {
    const p = Math.max(0, Math.min(1, (computeMET(s) - MET_START) / ETA_INIT))
    return { score: Math.round(p * 800 * mult), grade: '—' }
  }
  const st = s.stats
  const raw = 1000 + s.mainPwr * 10 + st.burnsOk * 150 - st.brownouts * 120 - st.overheats * 25 + Math.min(10, st.minTemp) * 10
  const sc = Math.round(Math.max(0, raw) * mult)
  const grade = sc >= 1800 ? 'S' : sc >= 1450 ? 'A' : sc >= 1150 ? 'B' : 'C'
  return { score: sc, grade }
}

function showEnd(s: GameState): void {
  setRunning(false)
  audio.stopAll()
  const win = s.phase === 'win'
  const { score: sc, grade } = score(s)
  const p = Math.max(0, Math.min(1, (computeMET(s) - MET_START) / ETA_INIT))
  const wrap = document.querySelector('.end-wrap')!
  wrap.className = `end-wrap ${win ? 'win' : 'lose'}`
  if (win) {
    audio.sfxWin()
    $('end-kicker').textContent = 'APR 17, 1970 · MET 142:54:41 · SPLASHDOWN'
    $('end-title').textContent = '濺落！三人生還'
    $('end-desc').textContent = '奧德賽號降落傘在南太平洋上空張開，硫磺島號（USS Iwo Jima）回收了全部三名太空人。休士頓的控制中心響起掌聲。'
    $('end-tip').textContent = s.stats.burnsOk < 3 ? '把三次歷史點火都完成，分數會更高；跳電和過熱都會扣分。' : ''
  } else {
    audio.sfxBad()
    const L = LOSE[s.loseReason!]
    $('end-kicker').textContent = `MISSION FAILURE · ${L.kicker}`
    $('end-title').textContent = L.title
    $('end-desc').textContent = L.desc
    $('end-tip').textContent = L.tip
  }
  $('end-grade').innerHTML = win ? `評等<br><b>${grade}</b><br>${sc} 分` : `航程完成<br><b>${Math.floor(p * 100)}%</b><br>${sc} 分`
  const st = s.stats
  const mm = Math.floor(s.elapsed / 60), ss = Math.floor(s.elapsed % 60)
  $('end-stats').innerHTML = [
    [`${mm}:${String(ss).padStart(2, '0')}`, '存活時間'],
    [`${s.mainPwr.toFixed(0)}%`, '剩餘電力'],
    [`${st.burnsOk}/3`, '歷史點火'],
    [`${st.brownouts}`, '跳電次數'],
  ].map(([b, t]) => `<div><b>${b}</b><span>${t}</span></div>`).join('')
  $('end-history').textContent = FACTS[Math.floor(Math.random() * FACTS.length)]

  const key = `best:${s.difficulty}`
  const prev = JSON.parse(store.get(key) ?? 'null') as { score: number; grade: string } | null
  if (!prev || sc > prev.score) store.set(key, JSON.stringify({ score: sc, grade }))
  show('end')
}

function renderBest(): void {
  const names: Record<Difficulty, string> = { training: '訓練', standard: '任務', hard: '1970' }
  const parts = (['training', 'standard', 'hard'] as Difficulty[]).map(d => {
    const b = JSON.parse(store.get(`best:${d}`) ?? 'null') as { score: number; grade: string } | null
    return b ? `${names[d]} ${b.grade !== '—' ? b.grade + ' · ' : ''}${b.score}` : null
  }).filter(Boolean)
  $('title-best').textContent = parts.length ? `最佳紀錄　${parts.join('　｜　')}` : ''
}

// ════════════════ 輸入 ════════════════
function tryToggle(id: DeviceId): void {
  if (!isRunning()) return
  const s = getState()
  const d = s.devices[id]
  if (s.brownout || s.elapsed < d.lockUntil) { audio.sfxDenied(); return }
  toggleDevice(id)
  audio.sfxClick(getState().devices[id].on)
}

function bindHold(el: HTMLElement, set: (v: boolean) => void): void {
  el.addEventListener('pointerdown', e => {
    if (!isRunning()) return
    e.preventDefault()
    el.setPointerCapture(e.pointerId)
    set(true)
  })
  const up = () => set(false)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  el.addEventListener('lostpointercapture', up)
  el.addEventListener('contextmenu', e => e.preventDefault())
}

function bindInputs(): void {
  for (const el of document.querySelectorAll<HTMLElement>('.sw')) {
    const id = el.dataset.dev as DeviceId
    el.querySelector('.toggle')!.addEventListener('click', () => tryToggle(id))
    el.addEventListener('pointerenter', () => setAmpPreview(getState().devices[id].on ? -AMP[id] : AMP[id]))
    el.addEventListener('pointerleave', () => setAmpPreview(null))
  }
  const valve = $('valve'), ignite = $('ignite')
  bindHold(valve, v => { setO2Held(v); if (v) audio.sfxClick(true) })
  bindHold(ignite, v => setBurnHeld(v))
  valve.addEventListener('pointerenter', () => setAmpPreview(AMP.o2Release))
  valve.addEventListener('pointerleave', () => setAmpPreview(null))
  ignite.addEventListener('pointerenter', () => setAmpPreview(getState().burn ? AMP_ENGINE : null))
  ignite.addEventListener('pointerleave', () => setAmpPreview(null))
  $('breaker').addEventListener('click', () => { if (isRunning() && getState().brownout) { doReset(); audio.sfxBreaker() } })
  $('master-alarm').addEventListener('click', () => silenceAlarm())

  const KEY_DEV: Record<string, DeviceId> = { Digit1: 'heater', Digit2: 'co2Filter', Digit3: 'navComp', Numpad1: 'heater', Numpad2: 'co2Filter', Numpad3: 'navComp' }
  window.addEventListener('keydown', e => {
    if (screen === 'intro') { introAbort?.(); return }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (screen === null && isRunning()) pause()
      else if (screen === 'pause') resume()
      else if (screen === 'brief' || screen === 'history') show(briefReturn)
      return
    }
    if (e.code === 'KeyM') { toggleMute(); return }
    if (e.code === 'KeyH' && screen === null) { openBrief(); return }
    if (e.code === 'Enter' && screen === 'title') { $('btn-start').click(); return }
    if (screen !== null || e.repeat) { if (e.code === 'Space' && screen === null) e.preventDefault(); return }
    if (KEY_DEV[e.code]) tryToggle(KEY_DEV[e.code])
    else if (e.code === 'Space') { e.preventDefault(); setO2Held(true); audio.sfxClick(true) }
    else if (e.code === 'KeyF') setBurnHeld(true)
    else if (e.code === 'KeyR') { if (getState().brownout) { doReset(); audio.sfxBreaker() } }
  })
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') setO2Held(false)
    if (e.code === 'KeyF') setBurnHeld(false)
  })
  window.addEventListener('blur', () => { setO2Held(false); setBurnHeld(false) })
  document.addEventListener('visibilitychange', () => { if (document.hidden && screen === null) pause() })

  // 選單
  for (const c of document.querySelectorAll<HTMLElement>('.diff-card')) {
    c.addEventListener('click', () => {
      difficulty = c.dataset.diff as Difficulty
      store.set('difficulty', difficulty)
      for (const o of document.querySelectorAll('.diff-card')) o.classList.toggle('sel', o === c)
    })
  }
  const intro = $<HTMLInputElement>('opt-intro')
  intro.checked = store.get('intro') !== '0'
  intro.addEventListener('change', () => store.set('intro', intro.checked ? '1' : '0'))
  $('btn-start').addEventListener('click', () => {
    audio.initAudio()
    if (!store.get('briefed')) { store.set('briefed', '1'); briefReturn = 'title'; show('brief'); $('btn-brief-go').dataset.go = '1'; return }
    begin()
  })
  $('btn-howto').addEventListener('click', () => { briefReturn = 'title'; $('btn-brief-go').dataset.go = '1'; show('brief') })
  $('btn-brief-go').addEventListener('click', () => {
    if (briefReturn === 'pause') { show('pause'); return }
    begin()
  })
  $('btn-brief-back').addEventListener('click', () => show(briefReturn))
  $('btn-history').addEventListener('click', () => { briefReturn = 'title'; show('history') })
  $('btn-history-back').addEventListener('click', () => show('title'))
  $('btn-skip').addEventListener('click', () => introAbort?.())
  $('scr-intro').addEventListener('pointerdown', e => { if ((e.target as HTMLElement).id !== 'btn-skip') introAbort?.() })
  $('btn-resume').addEventListener('click', resume)
  $('btn-pause-help').addEventListener('click', () => { briefReturn = 'pause'; show('brief') })
  $('btn-restart').addEventListener('click', startGame)
  $('btn-menu').addEventListener('click', toMenu)
  $('btn-retry').addEventListener('click', startGame)
  $('btn-end-menu').addEventListener('click', toMenu)
  $('btn-pause').addEventListener('click', () => { if (screen === null) pause(); else if (screen === 'pause') resume() })
  $('btn-help').addEventListener('click', openBrief)
  $('btn-mute').addEventListener('click', toggleMute)
}

function begin(): void {
  if ($<HTMLInputElement>('opt-intro').checked) void playIntro()
  else startGame()
}

function openBrief(): void {
  if (screen === null) { setRunning(false); audio.stopAll() }
  briefReturn = screen === null ? 'pause' : screen
  show('brief')
}

function toggleMute(): void {
  audio.setMuted(!audio.isMuted())
  $('btn-mute').classList.toggle('off', audio.isMuted())
}

function buildHistory(): void {
  const items: [string, string][] = [
    ['055:52', '休士頓請組員<b>攪拌低溫氧氣槽</b>。受損的電線在槽內引燃。'],
    ['055:54', '<b>2 號氧氣槽爆炸</b>，服務艙一整片外板被炸飛，兩組燃料電池失效。'],
    ['055:55', 'Swigert：「<b>Houston, we\'ve had a problem.</b>」'],
    ['061:30', '<b>DPS-1 點火</b>：用登月艙下降引擎把飛船推回「自由返航」軌道。'],
    ['077:08', '繞過<b>月球背面</b>，距地球 400,171 公里——人類到過最遠的地方。'],
    ['079:28', '<b>PC+2 點火</b>：繞月後加速，把返航時間縮短約 10 小時。'],
    ['第 4 天', 'CO2 逼近危險值。地面用膠帶、塑膠袋與手冊封面設計出<b>「郵箱」轉接器</b>。'],
    ['105:18', '<b>MCC-5</b>：沒有電腦對準，Lovell 以地球晨昏線手動校正航向。'],
    ['138:02', '<b>拋離服務艙</b>，組員第一次看到爆炸的慘狀。'],
    ['141:30', '<b>拋離登月艙</b>。CAPCOM：「Farewell, Aquarius, and we thank you.」'],
    ['142:54', '<b>濺落南太平洋</b>，三人全數生還。'],
  ]
  $('history-list').innerHTML = items.map(([t, d]) => `<li><time>${t}</time><span>${d}</span></li>`).join('')
}

// ════════════════ 主迴圈 ════════════════
let lastFrame = performance.now()
function frame(now: number): void {
  const dtw = Math.min(0.1, (now - lastFrame) / 1000)
  lastFrame = now
  const advanced = tick(now)
  const s = getState()
  const hud = renderHud(s)
  renderSpace({ progress: screen === 'title' || screen === 'brief' || screen === 'history' ? 0.2 : hud.progress, o2Releasing: s.o2Releasing, burning: s.burning, running: advanced })

  if (isRunning()) {
    updateEffects(s)
    updateCapcom(s, dtw)
    audio.updateAmbience({
      amp: computeAmp(s),
      overRed: s.ampOverRedSeconds > 0,
      o2Releasing: s.o2Releasing, burning: s.burning, brownout: s.brownout, running: true,
    })
    audio.setAlarm(hud.alarmSound)
    const cold = s.temp < TEMP_FROST - 2 || s.o2Tank < 15 || s.co2 > 8500
    audio.setHeartbeat(cold ? Math.round(Math.max(38, Math.min(110, s.temp < TEMP_FROST - 2 ? 40 + s.temp * 4 : 100))) : 0)

    if (s.brownout !== lastBrownout) {
      const crt = $('crt').parentElement!
      $('cabin').classList.toggle('is-brownout', s.brownout)
      if (s.brownout) { audio.sfxBrownout(); shake(); crt.classList.remove('on-anim'); crt.classList.add('off') }
      else { crt.classList.remove('off'); crt.classList.add('on-anim'); setTimeout(() => crt.classList.remove('on-anim'), 500) }
      lastBrownout = s.brownout
    }
    if (s.phase !== 'playing') {
      setTimeout(() => showEnd(getState()), s.phase === 'win' ? 600 : 900)
      setRunning(false)
      audio.stopAll()
      if (s.phase === 'lose') { shake(); flash() }
    }
  }
  requestAnimationFrame(frame)
}

function boot(): void {
  initSpace($('space'))
  initHud()
  initEffects()
  initCapcom()
  buildHistory()
  bindInputs()
  difficulty = (store.get('difficulty') as Difficulty) || 'standard'
  for (const o of document.querySelectorAll<HTMLElement>('.diff-card')) o.classList.toggle('sel', o.dataset.diff === difficulty)
  newGame(difficulty)
  renderBest()
  show('title')
  requestAnimationFrame(frame)
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__a13 = { getState }
}

boot()
