/**
 * CAPCOM（太空艙通訊員）：休士頓的聲音。
 * 三種訊息來源：
 *  1. 教學腳本（訓練模式／第一次玩）：按時間逐步介紹系統
 *  2. 情境提醒：讀狀態，哪裡快出事就提醒哪裡（有冷卻，避免洗版）
 *  3. 任務事件：讀 state.log（歷史事件、點火視窗、跳電、過熱）
 * 月球背面失聯（LOS）期間休士頓沉默——你只能靠自己。
 */
import type { GameState, DeviceId } from '../game/state'
import { computeAmp } from '../game/state'
import { AMP_REDLINE, OVERHEAT_LIMIT } from '../game/constants'
import type { MissionEventId } from '../game/mission'
import { MISSION_EVENTS } from '../game/mission'
import { sfxQuindar, sfxGood, sfxBad, sfxStatic } from './audio'

type Level = 'info' | 'warn' | 'crit' | 'good' | 'crew' | 'static'
type Msg = { who: string; text: string; level: Level }

const DEV_NAME: Record<DeviceId, string> = { heater: '暖氣', co2Filter: '濾罐', navComp: '導航' }

const TUTORIAL: { at: number; text: string }[] = [
  { at: 0.5, text: 'Aquarius，這裡是休士頓。服務艙沒了，你們只剩登月艙的電池。<b>ETA 歸零</b>就能回家。' },
  { at: 6, text: '<b>導航 <kbd>3</kbd></b> 已經開著：只有它開著，ETA 才會前進，偏離度（DEV）也才會修正。' },
  { at: 13, text: '看到 CO2 一直在漲嗎？打開<b>濾罐 <kbd>2</kbd></b>。注意開關下方的熱量條——<b>連續 8 秒會過熱</b>。' },
  { at: 22, text: '<b>10A 是保險絲上限</b>。導航 4A + 濾罐 5A = 9A，再開暖氣就 12A——<b>兩秒內不降就跳電</b>。' },
  { at: 32, text: '所以要<b>輪流</b>：濾罐過熱前關掉，換<b>暖氣 <kbd>1</kbd></b> 上場，兩台交替。' },
  { at: 44, text: '氧氣低於 30% 時，<b>按住放氧閥 <kbd>空白鍵</kbd></b>。但液態氧氣化會吸熱——<b>艙溫會掉很快</b>。' },
  { at: 56, text: '快到第一次點火了。到時候導航要開、DEV 夠低，然後<b>按住點火 <kbd>F</kbd></b>。點火也吃 2A。' },
]

const EVENT_TEXT: Partial<Record<MissionEventId, Msg>> = {
  los: { who: 'CAPCOM', text: '你們即將進入月球背面，<b>通訊中斷約 25 分鐘</b>。接下來只能靠你們自己了。', level: 'warn' },
  peri: { who: 'AQUARIUS · LOVELL', text: '我們在月球背面了……離地球 <b>400,171 公里</b>，人類從沒到過這麼遠的地方。', level: 'crew' },
  mailbox: { who: 'CAPCOM', text: '地面團隊用<b>膠帶、塑膠袋、飛行手冊封面</b>做出了「郵箱」，方形濾罐終於接上圓形孔——<b>濾罐效率 +30%</b>！', level: 'good' },
  smjet: { who: 'AQUARIUS · LOVELL', text: '服務艙拋離了……天啊，<b>整片面板都被炸掉了</b>。', level: 'crew' },
  lmjet: { who: 'CAPCOM', text: '<b>Farewell, Aquarius, and we thank you.</b> 登月艙拋離，它把三個人送回了家門口。', level: 'good' },
  entry: { who: 'SYS', text: '進入大氣層——<b>通訊黑障</b>。撐住，最後幾秒。', level: 'warn' },
}

const BURN_OPEN: Partial<Record<MissionEventId, string>> = {
  dps1: '<b>DPS-1 點火視窗開啟！</b>把你們推回自由返航軌道。導航開著、DEV 夠低，<b>按住 <kbd>F</kbd></b>。錯過的話偏離 +12%。',
  pc2: '<b>PC+2 點火！</b>繞過月球後加速回家。錯過的話<b>返航延長 5 小時</b>。點火 2A，先把濾罐關掉騰電流。',
  mcc5: '<b>MCC-5 手動校正。</b>導航電腦精度不夠，Lovell 要用地球晨昏線手動對準——<b>DEV 必須很低</b>。成功的話偏離歸零。',
}
const BURN_OK: Partial<Record<MissionEventId, string>> = {
  dps1: '漂亮！Aquarius，你們<b>回到自由返航軌道</b>了。',
  pc2: '<b>PC+2 完美。</b>回家的路縮短了，大家都在歡呼。',
  mcc5: '手動校正成功——<b>偏離度歸零</b>。Lovell，那是教科書等級的對準。',
}
const BURN_FAIL: Partial<Record<MissionEventId, string>> = {
  dps1: '點火視窗錯過了……軌道偏移，<b>DEV +12%</b>。',
  pc2: 'PC+2 失敗，<b>返航時間 +5 小時</b>。資源要撐更久了。',
  mcc5: '校正失敗，<b>DEV +10%</b>。',
}

let log: HTMLElement
let sig: HTMLElement
let queue: Msg[] = []
let lastShown = -99
let logCursor = 0
let tutorialStep = 0
let tutorialOn = false
let cooldown: Record<string, number> = {}
let wasLos = false
let navOffSince = -1
let wall = 0

export function initCapcom(): void {
  log = document.getElementById('capcom-log')!
  sig = document.getElementById('comm-sig')!
}

export function resetCapcom(tutorial: boolean): void {
  log.innerHTML = ''
  queue = []
  lastShown = -99
  logCursor = 0
  tutorialStep = 0
  tutorialOn = tutorial
  cooldown = {}
  wasLos = false
  navOffSince = -1
  wall = 0
}

function push(m: Msg, front = false): void {
  if (front) queue.unshift(m); else queue.push(m)
}

function show(m: Msg): void {
  const el = document.createElement('div')
  el.className = `msg ${m.level}`
  el.innerHTML = `<span class="who">${m.who}</span>${m.text}`
  for (const old of Array.from(log.children)) old.classList.add('old')
  log.appendChild(el)
  while (log.children.length > 7) log.firstElementChild!.remove()
  if (m.level === 'good') sfxGood()
  else if (m.level === 'static') sfxStatic()
  else if (m.level === 'crit' && m.who === 'SYS') sfxBad()
  else if (m.who === 'CAPCOM') sfxQuindar()
}

function advise(key: string, now: number, every: number, m: Msg): void {
  if ((cooldown[key] ?? -1e9) + every > now) return
  if (queue.some(q => q.text === m.text)) return
  cooldown[key] = now
  push(m)
}

export function updateCapcom(s: GameState, dtWall: number): void {
  wall += dtWall
  const now = s.elapsed
  const los = now < s.losUntil

  // 任務紀錄 → 訊息（失聯期間組員訊息仍會顯示）
  while (logCursor < s.log.length) {
    const e = s.log[logCursor++]
    if (e.kind === 'brownout') {
      show({ who: 'SYS', text: `<b>跳電！</b>主匯流排過載，所有設備斷電、電力 −3%${s.mods.degradeChance > 0 ? '，最後開的設備可能永久降效' : ''}。<b>按 <kbd>R</kbd> 或點斷路器復電。</b>`, level: 'crit' })
    } else if (e.kind === 'overheat') {
      push({ who: 'SYS', text: `${DEV_NAME[e.id as DeviceId]}<b>過熱</b>，強制冷卻 5 秒。下次在熱量條變紅前就關掉。`, level: 'warn' }, true)
    } else if (e.kind === 'burn-open') {
      push({ who: 'CAPCOM', text: BURN_OPEN[e.id as MissionEventId] ?? '點火視窗開啟。', level: 'crit' }, true)
    } else if (e.kind === 'burn-ok') {
      push({ who: 'CAPCOM', text: BURN_OK[e.id as MissionEventId] ?? '點火成功。', level: 'good' }, true)
    } else if (e.kind === 'burn-fail') {
      push({ who: 'CAPCOM', text: BURN_FAIL[e.id as MissionEventId] ?? '點火失敗。', level: 'crit' }, true)
    } else if (e.kind === 'event' && e.id && EVENT_TEXT[e.id as MissionEventId]) {
      const m = EVENT_TEXT[e.id as MissionEventId]!
      if (e.id === 'los') show(m); else push(m, true)
    }
  }

  // 失聯狀態（放在事件之後，讓「即將失聯」先出現）
  sig.textContent = los ? '✕ LOS 失聯' : '● LINK'
  sig.classList.toggle('los', los)
  if (los && !wasLos) { show({ who: '', text: '— — — 訊號中斷 LOSS OF SIGNAL — — —', level: 'static' }) }
  if (!los && wasLos) { push({ who: 'CAPCOM', text: 'Aquarius，休士頓。<b>訊號恢復</b>，很高興再聽到你們。', level: 'good' }, true) }
  wasLos = los

  // 教學腳本
  if (tutorialOn && !los) {
    const step = TUTORIAL[tutorialStep]
    if (step && now >= step.at) { push({ who: 'CAPCOM', text: step.text, level: 'info' }); tutorialStep++ }
  }

  // 情境提醒
  if (!los && s.phase === 'playing') {
    const amp = computeAmp(s)
    const d = s.devices
    if (!d.navComp.on) { if (navOffSince < 0) navOffSince = now } else navOffSince = -1

    if (s.brownout) { /* 已提示 */ }
    else if (amp > AMP_REDLINE) advise('amp', now, 4, { who: 'SYS', text: `負載 <b>${amp}A 超過 10A</b>！兩秒內關掉一台，否則跳電！`, level: 'crit' })
    if (s.co2 > 8000) advise('co2c', now, 10, { who: 'CAPCOM', text: `CO2 <b>${Math.round(s.co2)} ppm</b>，再上去就是致命濃度——<b>現在就開濾罐 <kbd>2</kbd></b>！`, level: 'crit' })
    else if (s.co2 > 5500 && !d.co2Filter.on) advise('co2w', now, 18, { who: 'CAPCOM', text: `CO2 爬到 ${Math.round(s.co2)} ppm 了，濾罐關著。找空檔開一下濾罐 <kbd>2</kbd>。`, level: 'warn' })
    if (s.temp < 3) advise('tempc', now, 10, { who: 'CAPCOM', text: `艙溫 <b>${s.temp.toFixed(1)}°C</b>，快結冰了！<b>開暖氣 <kbd>1</kbd></b>，別再放氧。`, level: 'crit' })
    else if (s.temp < 9 && !d.heater.on) advise('tempw', now, 20, { who: 'CAPCOM', text: `艙溫 ${s.temp.toFixed(1)}°C，窗戶開始結霜了。輪到暖氣 <kbd>1</kbd> 上場了。`, level: 'warn' })
    if (s.o2Tank < 15 && s.liqO2 > 0) advise('o2c', now, 10, { who: 'CAPCOM', text: `氧氣只剩 <b>${s.o2Tank.toFixed(0)}%</b>！<b>按住 <kbd>空白鍵</kbd></b> 放氧！`, level: 'crit' })
    else if (s.o2Tank < 30 && s.liqO2 > 0 && !s.o2Held) advise('o2w', now, 22, { who: 'CAPCOM', text: `氧氣 ${s.o2Tank.toFixed(0)}%。可以按住放氧閥 <kbd>空白鍵</kbd> 補一點——記得它會讓艙溫下降。`, level: 'warn' })
    if (s.mainPwr < 20) advise('pwr', now, 30, { who: 'CAPCOM', text: `電力剩 <b>${s.mainPwr.toFixed(0)}%</b>。每一安培都要算，非必要的先關。`, level: 'warn' })
    if (navOffSince >= 0 && now - navOffSince > 8 && !s.burn) advise('blind', now, 25, { who: 'CAPCOM', text: '你們在<b>盲飛</b>：ETA 停住了，偏離度看不見但在累積。別關太久。', level: 'warn' })
    if (d.navComp.on && s.dev > 25) advise('dev', now, 20, { who: 'CAPCOM', text: `偏離度 ${s.dev.toFixed(0)}%，50% 就再入失敗。導航保持開啟讓它修回來。`, level: 'warn' })
    for (const id of ['co2Filter', 'heater'] as const) {
      const dv = d[id]
      if (dv.on && dv.heat > OVERHEAT_LIMIT[id] * s.mods.overheatMul * 0.8)
        advise('hot' + id, now, 14, { who: 'SYS', text: `${DEV_NAME[id]}溫度過高，<b>先關掉讓它散熱</b>，不然會被鎖 5 秒。`, level: 'info' })
    }
    if (s.burn) {
      if (!d.navComp.on) advise('burnnav', now, 6, { who: 'CAPCOM', text: '點火需要導航！<b>打開導航 <kbd>3</kbd></b>。', level: 'crit' })
      else if (s.dev > s.burn.tol) advise('burndev', now, 8, { who: 'CAPCOM', text: `DEV ${s.dev.toFixed(1)}% 還太高（要 ≤ ${s.burn.tol}%），等導航修正下來再點火。`, level: 'warn' })
    }
  }

  // 出隊：一次一則，間隔 2.2 秒（真實時間）
  if (queue.length && wall - lastShown > 2.2 && !s.brownout) {
    const m = queue.shift()!
    if (!los || m.who !== 'CAPCOM' || m.level === 'good') show(m)
    lastShown = wall
  }
}

/** 給右下「下一個里程碑」用 */
export function nextMilestone(s: GameState): { title: string; burn: boolean } | null {
  const ev = MISSION_EVENTS[s.nextEvent]
  return ev ? { title: ev.title, burn: !!ev.burn } : null
}
