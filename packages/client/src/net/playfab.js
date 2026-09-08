// Thin PlayFab Client REST wrapper - no SDK dependency. Handles anonymous
// device login, the session ticket, and the title display name. Everything
// degrades gracefully to "offline" so single-player never breaks.

const TITLE_ID = import.meta.env.VITE_PLAYFAB_TITLE_ID || ''
const BASE = TITLE_ID ? `https://${TITLE_ID}.playfabapi.com` : ''
const DEVICE_KEY = 'ludo_device_id'
const NAME_KEY = 'ludo_display_name' // local cache so Home can render before login lands

// A plain observable-ish session object. Scenes read it and subscribe to changes.
export const session = {
  enabled: Boolean(TITLE_ID),
  ready: false, // a login attempt has completed (success or offline)
  offline: !TITLE_ID, // no title id, or the login call failed
  playFabId: null,
  entityToken: null,
  ticket: null,
  displayName: localStorageGet(NAME_KEY) || null,
  newAccount: false,
}

const listeners = new Set()
export function onSession(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit() {
  for (const fn of listeners) {
    try { fn(session) } catch { /* a scene tearing down mid-callback */ }
  }
}

function localStorageGet(k) {
  try { return localStorage.getItem(k) } catch { return null }
}
function localStorageSet(k, v) {
  try { localStorage.setItem(k, v) } catch { /* private mode */ }
}

function deviceId() {
  let id = localStorageGet(DEVICE_KEY)
  if (!id) {
    id = (crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    localStorageSet(DEVICE_KEY, id)
  }
  return id
}

// POST a PlayFab endpoint. `auth` = 'ticket' adds the session header.
async function call(path, body, auth) {
  if (!BASE) throw new Error('playfab disabled')
  const headers = { 'Content-Type': 'application/json' }
  if (auth === 'ticket' && session.ticket) headers['X-Authorization'] = session.ticket
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = json.errorMessage || json.error || `HTTP ${res.status}`
    const err = new Error(msg)
    err.playfab = json
    throw err
  }
  return json.data
}

// Anonymous login keyed to this device. Safe to call more than once.
export async function login() {
  if (!session.enabled) {
    session.ready = true
    emit()
    return session
  }
  try {
    const data = await call('/Client/LoginWithCustomID', {
      TitleId: TITLE_ID,
      CustomId: deviceId(),
      CreateAccount: true,
      InfoRequestParameters: {
        GetUserAccountInfo: true,
        GetPlayerProfile: true,
        ProfileConstraints: { ShowDisplayName: true },
      },
    })
    session.playFabId = data.PlayFabId
    session.ticket = data.SessionTicket
    session.entityToken = data.EntityToken?.EntityToken || null
    session.newAccount = Boolean(data.NewlyCreated)
    const name =
      data.InfoResultPayload?.PlayerProfile?.DisplayName ||
      data.InfoResultPayload?.AccountInfo?.TitleInfo?.DisplayName ||
      null
    if (name) {
      session.displayName = name
      localStorageSet(NAME_KEY, name)
    }
    session.offline = false
  } catch (err) {
    console.warn('[playfab] login failed, staying offline:', err.message)
    session.offline = true
  }
  session.ready = true
  emit()
  return session
}

// Set the unique title display name. Returns the accepted name, or throws.
export async function setDisplayName(name) {
  const clean = String(name || '').trim().slice(0, 25)
  if (clean.length < 3) throw new Error('name must be 3-25 characters')
  if (session.offline) {
    session.displayName = clean
    localStorageSet(NAME_KEY, clean)
    emit()
    return clean
  }
  const data = await call('/Client/UpdateUserTitleDisplayName', { DisplayName: clean }, 'ticket')
  session.displayName = data.DisplayName
  localStorageSet(NAME_KEY, data.DisplayName)
  emit()
  return data.DisplayName
}

// Fire-and-forget login on module load; scenes await `login()` or subscribe.
export const ready = login()
