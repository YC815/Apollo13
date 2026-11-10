import {
  ETA_INIT, PWR_INIT, O2_INIT, LIQO2_INIT,
  CO2_INIT, TEMP_INIT, DEV_INIT,
  AMP, AMP_ENGINE, DIFFICULTY, MET_START,
} from './constants'
import type { Difficulty, Mods } from './constants'
import type { MissionEventId } from './mission'
export type { Difficulty, Mods }

export type DeviceId = 'heater' | 'co2Filter' | 'navComp'

export type DeviceState = {
  on: boolean
  heat: number        // 熱量計（D-005）
  lockUntil: number   // 鎖定到 elapsed 的哪秒；0 = 沒鎖
  degraded: boolean   // 跳電 50% 機率永久降效
}

export type Phase = 'cutscene' | 'playing' | 'win' | 'lose'
export type LoseReason = 'power' | 'oxygen' | 'co2' | 'temp' | 'deviation'

export type GameState = {
  phase: Phase
  loseReason: LoseReason | null
  elapsed: number        // playing 開始後 real seconds

  // 7 組儀表數值（GDD §7-A）
  eta: number            // MET 秒，初始 313200；顯示格式化成 HH:MM:SS
  mainPwr: number        // %，只降不升
  o2Tank: number         // %
  liqO2: number          // 剩餘長按秒數，初始 30；顯示 ceil(liqO2/10) 個罐
  co2: number            // PPM
  temp: number           // °C
  dev: number            // %

  devices: Record<DeviceId, DeviceState>
  o2Held: boolean        // O2 釋放閥是否被按住
  brownout: boolean      // 是否跳電中（等 RESET）

  // 模擬簿記（不顯示）
  rng: () => number
  o2Releasing: boolean        // 本幀是否實際在釋放 O2（oxygen 算、temp 讀）
  devDriftAcc: number         // DEV 漂移秒累加器（D-003）
  devDriftSample: number      // 本模擬秒抽到的漂移率
  dev30PenaltyApplied: boolean
  lastDeviceOn: DeviceId | null
  ampOverRedSeconds: number

  // ── 難度與任務事件 ──
  difficulty: Difficulty
  mods: Mods
  burnHeld: boolean           // 玩家是否按住點火
  burning: boolean            // 本幀引擎是否在燒（計入 AMP）
  burn: ActiveBurn | null     // 進行中的點火視窗
  nextEvent: number           // MISSION_EVENTS 中下一個待觸發的索引
  mailbox: boolean            // 郵箱轉接器完成（濾罐增效）
  losUntil: number            // 通訊中斷到 elapsed 的哪秒
  log: LogEntry[]             // 事件紀錄（UI 讀取）
  stats: Stats
}

export type ActiveBurn = {
  id: MissionEventId
  until: number      // 視窗關閉的 elapsed
  progress: number   // 已累積點火秒數
  hold: number
  tol: number
}

export type LogEntry = {
  t: number
  kind: 'event' | 'burn-open' | 'burn-ok' | 'burn-fail' | 'brownout' | 'overheat'
  id?: MissionEventId | DeviceId
}

export type Stats = {
  brownouts: number
  overheats: number
  burnsOk: number
  burnsFailed: number
  minTemp: number
  minO2: number
  maxCo2: number
  maxDev: number
}

function makeDevice(): DeviceState {
  return { on: false, heat: 0, lockUntil: 0, degraded: false }
}

export function initialState(difficulty: Difficulty = 'standard'): GameState {
  return {
    phase: 'playing',
    loseReason: null,
    elapsed: 0,
    eta: ETA_INIT,
    mainPwr: PWR_INIT,
    o2Tank: O2_INIT,
    liqO2: LIQO2_INIT,
    co2: CO2_INIT,
    temp: TEMP_INIT,
    dev: DEV_INIT,
    devices: {
      heater: makeDevice(),
      co2Filter: makeDevice(),
      navComp: makeDevice(),
    },
    o2Held: false,
    brownout: false,
    rng: Math.random,
    o2Releasing: false,
    devDriftAcc: 0,
    devDriftSample: 0,
    dev30PenaltyApplied: false,
    lastDeviceOn: null,
    ampOverRedSeconds: 0,
    difficulty,
    mods: { ...DIFFICULTY[difficulty] },
    burnHeld: false,
    burning: false,
    burn: null,
    nextEvent: 0,
    mailbox: false,
    losUntil: 0,
    log: [],
    stats: {
      brownouts: 0, overheats: 0, burnsOk: 0, burnsFailed: 0,
      minTemp: TEMP_INIT, minO2: O2_INIT, maxCo2: CO2_INIT, maxDev: DEV_INIT,
    },
  }
}

/** 由 ETA 換算目前任務經過時間（MET 秒） */
export function computeMET(s: GameState): number {
  return MET_START + (ETA_INIT - s.eta)
}

// 衍生值：不存 state，每幀現算（D-008）
export function computeAmp(s: GameState): number {
  let amp = 0
  if (s.devices.heater.on)    amp += AMP.heater
  if (s.devices.co2Filter.on) amp += AMP.co2Filter
  if (s.devices.navComp.on)   amp += AMP.navComp
  if (s.o2Releasing)          amp += AMP.o2Release
  if (s.burning)              amp += AMP_ENGINE
  return amp
}
