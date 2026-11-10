import type { GameState, DeviceId } from './state'

export function applyToggleDevice(s: GameState, id: DeviceId): GameState {
  const d = s.devices[id]
  if (s.brownout) return s
  if (s.elapsed < d.lockUntil) return s
  const wasOff = !d.on
  d.on = !d.on
  if (wasOff && d.on) s.lastDeviceOn = id
  return s
}

export function applySetO2Held(s: GameState, held: boolean): GameState {
  if (held && s.brownout) return s
  s.o2Held = held
  return s
}

export function applyReset(s: GameState): GameState {
  if (!s.brownout) return s
  s.brownout = false
  return s
}

export function applySetBurnHeld(s: GameState, held: boolean): GameState {
  if (held && (s.brownout || !s.burn)) { s.burnHeld = false; return s }
  s.burnHeld = held
  return s
}
