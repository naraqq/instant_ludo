// Colyseus connection for online matches. Wraps auth + joinOrCreate and keeps a
// reconnection token so a dropped tab can rejoin the same seat.
import { Client } from '@colyseus/sdk'
import { ready, session } from './playfab.js'

const URL = import.meta.env.VITE_COLYSEUS_URL || ''
const RECONNECT_KEY = 'ludo_reconnect'

let client = null
function getClient() {
  if (!client) client = new Client(URL)
  return client
}

function stashReconnect(room) {
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
  if (!saved?.token || Date.now() - saved.at > 90_000) { clearReconnect(); return null }
  try {
    const room = await getClient().reconnect(saved.token)
    stashReconnect(room)
    return room
  } catch {
    clearReconnect()
    return null
  }
}

// Join (or create) an online match. `maxPlayers` 2-4; empty seats fill with bots.
export async function joinMatch({ maxPlayers = 2 } = {}) {
  if (!URL) throw new Error('online play is not configured')
  await ready // ensure the anonymous login has resolved
  const room = await getClient().joinOrCreate('ludo', {
    ticket: session.ticket || undefined,
    name: session.displayName || 'Guest',
    maxPlayers,
  })
  stashReconnect(room)
  return room
}

export { session } from './playfab.js'
