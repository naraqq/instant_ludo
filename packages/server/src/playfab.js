// Server-side PlayFab: verify a client's session ticket, and (later) grant
// match rewards. Uses the REST API with the title secret key - no SDK.
// PLAYFAB_SECRET_KEY is set only in the Colyseus Cloud environment, never in git.

const TITLE_ID = process.env.PLAYFAB_TITLE_ID || ''
const SECRET = process.env.PLAYFAB_SECRET_KEY || ''
const BASE = TITLE_ID ? `https://${TITLE_ID}.playfabapi.com` : ''

export const playfabEnabled = Boolean(TITLE_ID && SECRET)

async function serverCall(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SecretKey': SECRET },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.errorMessage || json.error || `HTTP ${res.status}`)
    err.playfab = json
    throw err
  }
  return json.data
}

// Returns { playFabId, name } for a valid ticket, or null when PlayFab is off.
// Throws when a ticket is supplied but invalid.
export async function verifyTicket(ticket) {
  if (!playfabEnabled) return null
  if (!ticket) throw new Error('missing session ticket')
  const data = await serverCall('/Server/AuthenticateSessionTicket', { SessionTicket: ticket })
  return {
    playFabId: data.UserInfo?.PlayFabId || null,
    name: data.UserInfo?.TitleInfo?.DisplayName || null,
  }
}

// Placeholder: award coins / XP to the human seats once a match ends.
// Wired up once the coin currency exists in Game Manager.
export async function awardMatchRewards(engineState, seats) {
  if (!playfabEnabled) return
  // TODO: AddUserVirtualCurrency + UpdatePlayerStatistics per human seat,
  // based on placement in engineState.finishOrder / progress.
  void engineState
  void seats
}
