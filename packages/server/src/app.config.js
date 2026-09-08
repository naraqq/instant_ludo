import { defineServer, defineRoom, monitor, playground } from 'colyseus'
import express from 'express'
import { LudoRoom } from './rooms/LudoRoom.js'
import { guestLogin } from './playfab.js'

// The web client lives on a different origin (Netlify); allow it to call /auth.
function cors(req, res, next) {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
}

export default defineServer({
  rooms: {
    ludo: defineRoom(LudoRoom),
  },

  express: (app) => {
    app.use(express.json())
    app.use('/auth', cors)

    app.get('/health', (_req, res) => res.json({ ok: true, service: 'elemental-ludo' }))

    // Server-authoritative anonymous login: device id -> PlayFab session ticket.
    app.post('/auth/guest', async (req, res) => {
      try {
        const out = await guestLogin(req.body?.deviceId)
        res.json(out)
      } catch (err) {
        console.error('[auth] guest login failed:', err.message)
        res.status(502).json({ error: 'login failed' })
      }
    })

    // Dev-only inspectors. Never expose these unprotected in production.
    if (process.env.NODE_ENV !== 'production') {
      app.use('/monitor', monitor())
      app.use('/playground', playground())
    }
  },
})
