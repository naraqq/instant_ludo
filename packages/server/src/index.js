// Colyseus Cloud runs this file directly (no build step for plain ESM).
import { listen } from '@colyseus/tools'
import app from './app.config.js'

listen(app)
