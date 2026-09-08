// Identity for the client. New PlayFab titles disable client-side account
// creation, so login is server-authoritative: we send a per-device id to our
// own Colyseus server's /auth/guest, which does the PlayFab login and hands
// back a session ticket. Everything degrades to "offline" so solo play is safe.

const COLYSEUS_URL = import.meta.env.VITE_COLYSEUS_URL || ''
// wss://host -> https://host  (the auth endpoint is plain HTTP on the same host)
const AUTH_BASE = COLYSEUS_URL.replace(/^ws/, 'http')
const TITLE_ID = import.meta.env.VITE_PLAYFAB_TITLE_ID || ''
const DEVICE_KEY = 'ludo_device_id'
const NAME_KEY = 'ludo_display_name'

export const session = {
  enabled: Boolean(COLYSEUS_URL),
  ready: false,
  offline: !COLYSEUS_URL,
  playFabId: null,
  ticket: null,
  entityToken: null,
  displayName: lsGet(NAME_KEY) || null,
  newAccount: false,
}

const listeners = new Set()
export function onSession(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit() {
  for (const fn of listeners) { try { fn(session) } catch { /* scene torn down */ } }
}

function lsGet(k) { try { return localStorage.getItem(k) } catch { return null } }
function lsSet(k, v) { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

function deviceId() {
  let id = lsGet(DEVICE_KEY)
  if (!id) {
    id = crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`
    lsSet(DEVICE_KEY, id)
  }
  return id
}

export async function login() {
  if (!session.enabled) { session.ready = true; emit(); return session }
  try {
    const res = await fetch(`${AUTH_BASE}/auth/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId() }),
    })
    if (!res.ok) throw new Error(`auth HTTP ${res.status}`)
    const data = await res.json()
    session.playFabId = data.playFabId || null
    session.ticket = data.ticket || null
    session.entityToken = data.entityToken || null
    session.newAccount = Boolean(data.newAccount)
    if (data.name) { session.displayName = data.name; lsSet(NAME_KEY, data.name) }
    session.offline = Boolean(data.offline)
  } catch (err) {
    console.warn('[auth] login failed, staying offline:', err.message)
    session.offline = true
  }
  session.ready = true
  emit()
  return session
}

// Rename via the PlayFab client API (works with the ticket we already hold;
// this call is not account creation, so it isn't gated).
export async function setDisplayName(name) {
  const clean = String(name || '').trim().slice(0, 25)
  if (clean.length < 3) throw new Error('name must be 3-25 characters')
  if (session.offline || !session.ticket || !TITLE_ID) {
    session.displayName = clean
    lsSet(NAME_KEY, clean)
    emit()
    return clean
  }
  const res = await fetch(`https://${TITLE_ID}.playfabapi.com/Client/UpdateUserTitleDisplayName`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Authorization': session.ticket },
    body: JSON.stringify({ DisplayName: clean }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.errorMessage || `HTTP ${res.status}`)
  session.displayName = json.data?.DisplayName || clean
  lsSet(NAME_KEY, session.displayName)
  emit()
  return session.displayName
}

export const ready = login()
