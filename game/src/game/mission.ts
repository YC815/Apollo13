/**
 * 任務時間軸：依真實阿波羅 13 號 MET（任務經過時間）觸發的歷史事件。
 * 時間來源：NASA Apollo Flight Journal、NTRS 20090026451（燃燒時刻）、SP-4029。
 * 事件只在 ETA 推進（導航開啟）時前進，因為 MET 由 ETA 換算。
 */
const h = (hh: number, mm: number) => hh * 3600 + mm * 60

export type BurnSpec = {
  window: number      // 視窗長度（real 秒）
  hold: number        // 需累積點火秒數
  tol: number         // DEV 容許上限（%）
  fail: { dev?: number; etaHours?: number }
  success: { devZero?: boolean; etaHours?: number }
}

export type MissionEventId =
  | 'dps1' | 'los' | 'peri' | 'pc2' | 'mailbox' | 'mcc5' | 'smjet' | 'lmjet' | 'entry'

export type MissionEvent = {
  id: MissionEventId
  met: number
  title: string       // 時間軸短名
  burn?: BurnSpec
  losSeconds?: number // 通訊中斷（real 秒）
}

export const MISSION_EVENTS: MissionEvent[] = [
  { id: 'dps1', met: h(61, 30), title: 'DPS-1 自由返航點火',
    burn: { window: 22, hold: 5, tol: 6, fail: { dev: 12 }, success: {} } },
  { id: 'los', met: h(76, 42), title: '月球背面・失聯', losSeconds: 12 },
  { id: 'peri', met: h(77, 8), title: '近月點' },
  { id: 'pc2', met: h(79, 28), title: 'PC+2 加速點火',
    burn: { window: 24, hold: 7, tol: 5, fail: { etaHours: 5 }, success: {} } },
  { id: 'mailbox', met: h(93, 0), title: '「郵箱」CO2 轉接器' },
  { id: 'mcc5', met: h(105, 18), title: 'MCC-5 手動校正',
    burn: { window: 20, hold: 4, tol: 3, fail: { dev: 10 }, success: { devZero: true } } },
  { id: 'smjet', met: h(138, 2), title: '拋離服務艙' },
  { id: 'lmjet', met: h(141, 30), title: '告別水瓶座' },
  { id: 'entry', met: h(142, 40), title: '再入大氣層' },
]

export function formatMET(sec: number): string {
  const t = Math.max(0, Math.floor(sec))
  const hh = Math.floor(t / 3600), mm = Math.floor((t % 3600) / 60), ss = t % 60
  return `${String(hh).padStart(3, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}
