import type { GameState, LoseReason } from '../src/game/state'
import { initialState, computeAmp } from '../src/game/state'
import { step } from '../src/game/systems/index'
import { applyToggleDevice, applySetO2Held, applyReset, applySetBurnHeld } from '../src/game/input'
import { FIXED_DT } from '../src/game/constants'
import { mulberry32 } from '../tests/helpers'
import type { PlayerAgent } from './playerAgent'

export type RunOptions = {
  seed?: number
  difficulty?: import('../src/game/state').Difficulty
  maxSeconds?: number
  record?: boolean
}

export type Snapshot = {
  t: number
  eta: number; mainPwr: number; o2Tank: number; liqO2: number
  co2: number; temp: number; dev: number; amp: number
  heater: boolean; co2Filter: boolean; navComp: boolean
  brownout: boolean
}

export type RunResult = {
  agent: string
  seed: number
  outcome: 'win' | 'lose' | 'timeout'
  loseReason: LoseReason | null
  endSecond: number
  final: Snapshot
  timeline: Snapshot[]
  stats: {
    brownouts: number
    degraded: string[]
    minTemp: number; minO2: number; maxCo2: number; maxDev: number
    navOnSeconds: number
  }
}

function snapshot(s: GameState, t: number): Snapshot {
  return {
    t,
    eta: s.eta, mainPwr: s.mainPwr, o2Tank: s.o2Tank, liqO2: s.liqO2,
    co2: s.co2, temp: s.temp, dev: s.dev, amp: computeAmp(s),
    heater: s.devices.heater.on,
    co2Filter: s.devices.co2Filter.on,
    navComp: s.devices.navComp.on,
    brownout: s.brownout,
  }
}

export function runGame(agent: PlayerAgent, opts: RunOptions = {}): RunResult {
  const seed = opts.seed ?? 1
  const maxSeconds = opts.maxSeconds ?? 1200
  const record = opts.record ?? true

  const s = initialState(opts.difficulty ?? 'standard')
  s.rng = mulberry32(seed)

  const timeline: Snapshot[] = []
  const stats = {
    brownouts: 0,
    degraded: [] as string[],
    minTemp: s.temp,
    minO2: s.o2Tank,
    maxCo2: s.co2,
    maxDev: s.dev,
    navOnSeconds: 0,
  }

  let t = 0
  for (; t < maxSeconds && s.phase === 'playing'; t++) {
    const intent = agent.decide(s as Readonly<GameState>, t)

    if (intent.reset) applyReset(s)
    for (const id of intent.toggles) applyToggleDevice(s, id)
    applySetO2Held(s, intent.o2Held)
    applySetBurnHeld(s, intent.burn ?? false)

    const wasBrownout = s.brownout
    for (let f = 0; f < 60; f++) step(s, FIXED_DT)
    if (!wasBrownout && s.brownout) stats.brownouts++

    if (s.devices.navComp.on) stats.navOnSeconds++
    if (s.temp < stats.minTemp) stats.minTemp = s.temp
    if (s.o2Tank < stats.minO2) stats.minO2 = s.o2Tank
    if (s.co2 > stats.maxCo2) stats.maxCo2 = s.co2
    if (s.dev > stats.maxDev) stats.maxDev = s.dev

    if (record) timeline.push(snapshot(s, t + 1))
  }

  const outcome = s.phase === 'win' ? 'win'
    : s.phase === 'lose' ? 'lose'
    : 'timeout'

  for (const id of ['heater', 'co2Filter', 'navComp'] as const) {
    if (s.devices[id].degraded) stats.degraded.push(id)
  }

  return {
    agent: agent.name,
    seed,
    outcome,
    loseReason: s.loseReason,
    endSecond: t,
    final: snapshot(s, t),
    timeline,
    stats,
  }
}
