// The Colyseus-synced state. The authoritative game lives in `gameJson` (a
// stringified engine `publicView`); the rest is lobby / turn-clock metadata the
// client needs even before or between games, and for a clean reconnect.
import { schema, t } from '@colyseus/schema'

export const Seat = schema({
  color: t.string().default(''),
  name: t.string().default(''),
  playFabId: t.string().default(''),
  bot: t.boolean().default(false),
  connected: t.boolean().default(true),
})

export const LudoState = schema({
  // 'lobby' | 'playing' | 'gameover'
  phase: t.string().default('lobby'),
  // colour whose turn it is, '' outside a game
  currentColor: t.string().default(''),
  // room-clock time (ms) the current turn expires at
  turnDeadline: t.number().default(0),
  // JSON.stringify(publicView(engineState)) — the whole board
  gameJson: t.string().default(''),
  // seats keyed by Colyseus sessionId
  seats: t.map(Seat),
})
