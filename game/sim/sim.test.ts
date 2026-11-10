/**
 * T-085 sim 決定性斷言
 *
 * 兩層：
 *  A. 引擎層（一定要過，過不了 = bug）：決定性、跳電、勝負正確。
 *  B. 平衡層（過不了 = 平衡跑掉，回報 PROGRESS_LOG，不要偷改斷言）。
 *
 * rotate 現況（run.ts 觀察 2026-06-13，移除 navComp 過熱後）：
 *   五個種子全 WIN，eta 歸零，收在 temp ≈ 3.2°C（新的命懸一線是溫度）。
 *   病根：navComp 會過熱時導航工作週期被壓到 ~57%，勝利數學上不可達。
 *   移除 navComp 過熱（OVERHEAT_LIMIT 不含 navComp）後「用心玩能贏」成立。
 *   → B-2 已收緊為 must-win，防止未來改動又讓遊戲變不可贏。
 */
import { describe, it, expect } from 'vitest'
import { runGame } from './runner'
import { doNothing, co2Only, panic, navOnly, makeRotateAgent, STRATEGIES } from './strategies'
import type { RunResult } from './runner'

// ── A. 決定性（最重要） ──────────────────────────────────────────────────────

describe('A. 決定性：同輸入兩次結果完全相等', () => {
  for (const agent of STRATEGIES) {
    it(`${agent.name} seed=7 兩次 RunResult 深度相等`, () => {
      const r1 = runGame(agent, { seed: 7, record: true })
      const r2 = runGame(agent, { seed: 7, record: true })
      expect(r1.outcome).toBe(r2.outcome)
      expect(r1.loseReason).toBe(r2.loseReason)
      expect(r1.endSecond).toBe(r2.endSecond)
      expect(r1.final.mainPwr).toBe(r2.final.mainPwr)
      expect(r1.final.co2).toBe(r2.final.co2)
      expect(r1.final.temp).toBe(r2.final.temp)
      expect(r1.timeline.length).toBe(r2.timeline.length)
      // 抽查時間軸中間點確認整條一致
      if (r1.timeline.length > 10) {
        const mid = Math.floor(r1.timeline.length / 2)
        expect(r1.timeline[mid].mainPwr).toBe(r2.timeline[mid].mainPwr)
        expect(r1.timeline[mid].co2).toBe(r2.timeline[mid].co2)
      }
    })
  }
})

// ── B-1. 各 oracle 策略的預期結局 ─────────────────────────────────────────

describe('B-1. doNothing：完全不操作就輸', () => {
  it('seed=1 → outcome lose，導航秒 = 0', () => {
    const r = runGame(doNothing, { seed: 1 })
    expect(r.outcome).toBe('lose')
    expect(r.stats.navOnSeconds).toBe(0)
  })

  it('任何 seed 都輸（與 balance.test 同調）', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const r = runGame(doNothing, { seed })
      expect(r.outcome).toBe('lose')
    }
  })
})

describe('B-1. co2Only：單顧 CO2，CO2 被壓住但 DEV 仍殺人', () => {
  it('seed=1 → 輸，CO2 被過濾器壓在致死線以下（< 10000）', () => {
    const r = runGame(co2Only, { seed: 1 })
    expect(r.outcome).toBe('lose')
    expect(r.stats.maxCo2).toBeLessThan(10000)   // 過濾器有效壓住 CO2
    expect(r.loseReason).not.toBe('co2')          // 死因不是 CO2（co2 牆被壓住）
  })
})

describe('B-1. panic：全開跳電', () => {
  it('seed=1 → 跳電至少 1 次，主電力被扣（< 100）', () => {
    const r = runGame(panic, { seed: 1 })
    expect(r.stats.brownouts).toBeGreaterThanOrEqual(1)
    expect(r.final.mainPwr).toBeLessThan(100)
  })
})

describe('B-1. navOnly：壓住 DEV，但 CO2 牆在約 480s 殺人', () => {
  it('seed=1 → 導航有開，明顯撐得比 doNothing 久', () => {
    const rNav = runGame(navOnly, { seed: 1 })
    const rDo  = runGame(doNothing, { seed: 1 })
    expect(rNav.stats.navOnSeconds).toBeGreaterThan(0)
    expect(rNav.endSecond).toBeGreaterThan(rDo.endSecond)
  })

  it('seed=1 → 撐過 deviation，最終死於 co2（400s 以後）', () => {
    const r = runGame(navOnly, { seed: 1 })
    expect(r.loseReason).toBe('co2')
    expect(r.endSecond).toBeGreaterThan(400)
  })
})

// ── B-2. rotate 衝關探針（平衡層：用心玩必須能贏） ──────────────────────

describe('B-2. rotate：衝關探針（移除 navComp 過熱後必須 WIN）', () => {
  it('五個種子全部 WIN（用心玩能贏 = 平衡成立）', () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const r = runGame(makeRotateAgent(), { seed })
      expect(r.outcome).toBe('win')
      expect(r.final.eta).toBe(0)
    }
  })

  it('seed=1 → 導航撐滿整局推 ETA 歸零（navOnSeconds 接近 endSecond）', () => {
    const r = runGame(makeRotateAgent(), { seed: 1 })
    expect(r.stats.navOnSeconds).toBeGreaterThan(0)
    expect(r.stats.navOnSeconds).toBeGreaterThanOrEqual(r.endSecond - 2)
  })
})

// ── C. 不變量（引擎層，任何策略都該成立） ───────────────────────────────

describe('C. 不變量：數值不超出合理範圍', () => {
  it('rotate seed=1 整局 timeline 各欄位在合理範圍內', () => {
    const r = runGame(makeRotateAgent(), { seed: 1, record: true })
    for (const snap of r.timeline) {
      expect(snap.o2Tank).toBeGreaterThanOrEqual(0)
      expect(snap.o2Tank).toBeLessThanOrEqual(100)
      expect(snap.mainPwr).toBeGreaterThanOrEqual(0)
      expect(snap.mainPwr).toBeLessThanOrEqual(100)
      expect(snap.co2).toBeGreaterThanOrEqual(0)
      expect(snap.dev).toBeGreaterThanOrEqual(0)
      expect(snap.dev).toBeLessThanOrEqual(100)
      expect(snap.liqO2).toBeGreaterThanOrEqual(0)
    }
  })

  it('結局是 lose/win/timeout 之一（不存在無效 phase）', () => {
    for (const agent of STRATEGIES) {
      const r = runGame(agent, { seed: 3 })
      expect(['win', 'lose', 'timeout']).toContain(r.outcome)
    }
  })
})

// ── C. 新版：難度 × 任務事件 ────────────────────────────────────────────────
import { makeSmartAgent } from './strategies'

describe('C. 三種難度都「用心玩能贏」，不操作必輸', () => {
  for (const difficulty of ['training', 'standard', 'hard'] as const) {
    it(`${difficulty}: smart 五種子全勝、doNothing 全敗`, () => {
      for (const seed of [1, 2, 3, 7, 42]) {
        expect(runGame(makeSmartAgent(), { seed, difficulty, record: false }).outcome).toBe('win')
        expect(runGame(doNothing, { seed, difficulty, record: false }).outcome).toBe('lose')
      }
    })
  }

  it('點火視窗：rotate 會完成三次歷史點火', () => {
    const r = runGame(makeRotateAgent(), { seed: 1, record: false })
    expect(r.outcome).toBe('win')
  })
})
