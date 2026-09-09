// Colyseus connection for online matches. Wraps auth + joinOrCreate and keeps a
// reconnection token so a dropped tab can rejoin the same seat.
import { Client } from '@colyseus/sdk'
import { ready, session } from './playfab.js'

const URL = import.meta.env.VITE_COLYSEUS_URL || ''
const AUTH_BASE = URL.replace(/^ws/, 'http') // wss:// -> https:// for the REST routes
const RECONNECT_KEY = 'ludo_reconnect'

let client = null
function getClient() {
  if (!client) client = new Client(URL)
  return client
}

export function stashReconnect(room) {
  try {
    sessionStorage.setItem(RECONNECT_KEY, JSON.stringify({
      token: room.reconnectionToken,
      roomId: room.roomId,
      at: Date.now(),
    }))
  } catch { /* private mode */ }
}

export function clearReconnect() {
  try { sessionStorage.removeItem(RECONNECT_KEY) } catch { /* noop */ }
}

// Try to slip back into a match this tab was in (page reload / brief drop).
export async function tryReconnect() {
  if (!URL) return null
  let saved
  try { saved = JSON.parse(sessionStorage.getItem(RECONNECT_KEY) || 'null') } catch { saved = null }
  // The server owns the grace period; a long-running tab can have an older token.
  if (!saved?.token) { clearReconnect(); return null }
  try {
    const room = await getClient().reconnect(saved.token)
    stashReconnect(room)
    return room
  } catch {
    clearReconnect()
    return null
  }
}

function joinOpts(extra) {
  return {
    eventSnapshots: true,
    ticket: session.ticket || undefined,
    name: session.displayName || 'Guest',
    ...extra,
  }
}

// Quick match: join any open public room, or make one. Empty seats fill with bots.
export async function joinMatch({ maxPlayers = 4 } = {}) {
  if (!URL) throw new Error('online play is not configured')
  await ready
  const room = await getClient().joinOrCreate('ludo', joinOpts({ maxPlayers }))
  stashReconnect(room)
  return room
}

// Solo vs a bot on the real server. A private room that starts the moment we
// join - use it to exercise the full online path (auth, join, state sync,
// events, reconnect) without a second player.
export async function soloMatch({ maxPlayers = 2 } = {}) {
  if (!URL) throw new Error('online play is not configured')
  await ready
  const room = await getClient().create('ludo', joinOpts({ maxPlayers, solo: true }))
  stashReconnect(room)
  return room
}

// Create a private room; the 6-digit code lands in room.state.code to share.
export async function createRoom({ maxPlayers = 2 } = {}) {
  if (!URL) throw new Error('online play is not configured')
  await ready
  const room = await getClient().create('ludo', joinOpts({ maxPlayers, private: true }))
  stashReconnect(room)
  return room
}

// Join a private room by its 6-digit code.
export async function joinByCode(code) {
  if (!URL) throw new Error('online play is not configured')
  const clean = String(code || '').replace(/\D/g, '').slice(0, 6)
  if (clean.length !== 6) throw new Error('enter a 6-digit code')
  await ready
  const res = await fetch(`${AUTH_BASE}/find/${clean}`)
  if (res.status === 404) throw new Error('no room with that code')
  if (!res.ok) throw new Error('could not look up that code')
  const { roomId } = await res.json()
  const room = await getClient().joinById(roomId, joinOpts({}))
  stashReconnect(room)
  return room
}

export { session } from './playfab.js'
