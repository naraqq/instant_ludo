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
  // Human seat temporarily controlled by the server after an inactivity timeout.
  auto: t.boolean().default(false),
})

export const LudoState = schema({
  // 'lobby' | 'playing' | 'gameover'
  phase: t.string().default('lobby'),
  // 6-digit join code for private rooms ('' for quick match)
  code: t.string().default(''),
  // sessionId of the room host (private rooms) - may press "start"
  hostId: t.string().default(''),
  maxSeats: t.number().default(2),
  // 2v2 team match (diagonal pairs); false = free-for-all
  teams: t.boolean().default(false),
  // winning team (0 | 1) once a team match is decided, else -1
  winningTeam: t.number().default(-1),
  // colour whose turn it is, '' outside a game
  currentColor: t.string().default(''),
  // room-clock time (ms) the current turn expires at
  turnDeadline: t.number().default(0),
  // authoritative length of the currently armed clock (ms)
  turnDuration: t.number().default(0),
  // JSON.stringify(publicView(engineState)) — the whole board
  gameJson: t.string().default(''),
  // seats keyed by Colyseus sessionId
  seats: t.map(Seat),
})
