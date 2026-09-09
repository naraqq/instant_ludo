// The board, painted once to an offscreen 2x canvas and used as a single image.
// Full Canvas2D control (gradients, bevels, soft shadows, crisp stars) at one
// draw call. Aligns 1:1 with gridToPixel() at _boardRot 0; the online scene
// rotates the whole image to match its perspective.
import {
  COLORS, COLOR_HEX, COLOR_DARK, COLOR_LIGHT, BOARD_PALETTE,
  SAFE_STOPS, HOME_LANES, YARDS, TRACK, START_INDEX,
} from '@ludo/engine'
import { TILE, BOARD_SIZE } from './constants.js'

const START_OWNER = Object.fromEntries(Object.entries(START_INDEX).map(([c, i]) => [i, c]))
const hx = (n) => '#' + ((n >>> 0) & 0xffffff).toString(16).padStart(6, '0')
const rgba = (n, alpha) => `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`

// centre point (grid) each colour's home lane runs toward
const HOME_DIR = { red: [1, 0], green: [0, 1], yellow: [-1, 0], blue: [0, -1] }

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

function star(ctx, cx, cy, outer, inner, points = 5) {
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? outer : inner
    const a = (i * Math.PI) / points - Math.PI / 2
    const px = cx + Math.cos(a) * rad
    const py = cy + Math.sin(a) * rad
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
  }
  ctx.closePath()
}

export function buildBoardCanvas({ simple = false } = {}) {
  const S = 2
  const cell = TILE * S
  const size = BOARD_SIZE * S
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')
  const C = size / 2

  // -------- base --------
  rr(ctx, 0, 0, size, size, 30 * S)
  ctx.save()
  ctx.clip()
  const base = ctx.createLinearGradient(0, 0, 0, size)
  base.addColorStop(0, '#f2f4fa')
  base.addColorStop(1, '#dde2ee')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  // soft centre glow
  const glow = ctx.createRadialGradient(C, C, cell, C, C, size * 0.62)
  glow.addColorStop(0, 'rgba(255,255,255,0.55)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, size, size)

  // -------- yards --------
  for (const color of COLORS) {
    const [bx, by] = YARDS[color].box
    const x = bx * cell
    const y = by * cell
    const w = 6 * cell
    const yg = ctx.createLinearGradient(x, y, x + w * 0.4, y + w)
    yg.addColorStop(0, hx(COLOR_HEX[color]))
    yg.addColorStop(0.6, hx(COLOR_HEX[color]))
    yg.addColorStop(1, hx(COLOR_DARK[color]))
    ctx.fillStyle = simple ? hx(COLOR_HEX[color]) : yg
    ctx.fillRect(x, y, w, w)
    if (simple) {
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'
      ctx.lineWidth = 1.5 * S
      ctx.strokeRect(x + S, y + S, w - 2 * S, w - 2 * S)
    }
    // faint concentric crest watermark
    if (!simple) {
      ctx.save()
      ctx.globalAlpha = 0.09
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 3 * S
      for (let k = 1; k <= 3; k++) {
        ctx.beginPath()
        ctx.arc(x + w / 2, y + w / 2, k * 0.9 * cell, 0, 7)
        ctx.stroke()
      }
      ctx.restore()
      // top sheen - restrained, so the colour stays solid
      const sheen = ctx.createLinearGradient(x, y, x, y + w * 0.42)
      sheen.addColorStop(0, 'rgba(255,255,255,0.14)')
      sheen.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = sheen
      ctx.fillRect(x, y, w, w * 0.42)
    }

    // recessed holder
    const hxs = x + cell
    const hys = y + cell
    const hw = 4 * cell
    ctx.save()
    if (!simple) {
      ctx.shadowColor = 'rgba(0,0,0,0.35)'
      ctx.shadowBlur = 12 * S
      ctx.shadowOffsetY = 5 * S
    }
    rr(ctx, hxs, hys, hw, hw, 22 * S)
    // darker inset, not a white patch - the base stays a strong solid colour
    ctx.fillStyle = simple ? rgba(COLOR_DARK[color], 0.42) : rgba(COLOR_DARK[color], 0.34)
    ctx.fill()
    ctx.restore()
    rr(ctx, hxs, hys, hw, hw, 22 * S)
    ctx.strokeStyle = simple ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.4)'
    ctx.lineWidth = (simple ? 1.5 : 3) * S
    ctx.stroke()
    rr(ctx, hxs + 2 * S, hys + 2 * S, hw - 4 * S, hw - 4 * S, 20 * S)
    ctx.strokeStyle = simple ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'
    ctx.lineWidth = 2 * S
    ctx.stroke()
    // 4 sockets
    const cols = [bx + 2.1, bx + 3.9]
    const rows = [by + 2.3, by + 4.15]
    for (const px of cols) {
      for (const py of rows) {
        ctx.beginPath()
        if (simple) ctx.arc(px * cell, py * cell, 18 * S, 0, 7)
        else ctx.ellipse(px * cell, (py + 0.28) * cell, 20 * S, 9 * S, 0, 0, 7)
        ctx.fillStyle = simple ? hx(COLOR_DARK[color]) : hx(COLOR_HEX[color])
        ctx.globalAlpha = simple ? 0.5 : 0.16
        ctx.fill()
        ctx.globalAlpha = 1
      }
    }
  }

  // -------- track channel --------
  ctx.fillStyle = simple ? 'rgba(150,163,190,0.03)' : 'rgba(150,163,190,0.10)'
  rr(ctx, 6 * cell, 0, 3 * cell, size, 4 * S)
  ctx.fill()
  rr(ctx, 0, 6 * cell, size, 3 * cell, 4 * S)
  ctx.fill()

  const drawTile = (gx, gy, fill, opts = {}) => {
    const inset = (simple ? 0.5 : 2) * S
    const x = gx * cell + inset
    const y = gy * cell + inset
    const s = cell - inset * 2
    const radius = (simple ? 2 : 9) * S
    rr(ctx, x, y, s, s, radius)
    ctx.save()
    ctx.shadowColor = simple ? 'rgba(30,40,70,0.06)' : 'rgba(30,40,70,0.18)'
    ctx.shadowBlur = (simple ? 0 : 4) * S
    ctx.shadowOffsetY = simple ? 0 : 2 * S
    ctx.fillStyle = fill
    ctx.fill()
    ctx.restore()
    if (simple) {
      rr(ctx, x, y, s, s, radius)
      ctx.strokeStyle = 'rgba(107,125,154,0.22)'
      ctx.lineWidth = S
      ctx.stroke()
    }
    // top highlight
    if (!simple) {
      const hl = ctx.createLinearGradient(x, y, x, y + s)
      hl.addColorStop(0, 'rgba(255,255,255,0.32)')
      hl.addColorStop(0.45, 'rgba(255,255,255,0)')
      hl.addColorStop(1, 'rgba(0,0,0,0.07)')
      rr(ctx, x, y, s, s, radius)
      ctx.fillStyle = hl
      ctx.fill()
    }
    if (opts.stroke) {
      rr(ctx, x + 0.5 * S, y + 0.5 * S, s - S, s - S, Math.max(S, radius - S))
      ctx.strokeStyle = opts.stroke
      ctx.lineWidth = 2 * S
      ctx.stroke()
    }
  }

  // track squares
  TRACK.forEach(([gx, gy], i) => {
    const owner = START_OWNER[i]
    const safe = SAFE_STOPS.has(i)
    if (owner) {
      drawTile(gx, gy, simple ? rgba(COLOR_HEX[owner], 0.96) : hx(COLOR_HEX[owner]), { stroke: 'rgba(255,255,255,0.35)' })
    } else if (safe) {
      drawTile(gx, gy, hx(BOARD_PALETTE.safe))
      // soft pad + crisp star
      const cx2 = (gx + 0.5) * cell
      const cy2 = (gy + 0.5) * cell
      ctx.beginPath()
      ctx.arc(cx2, cy2, 14 * S, 0, 7)
      ctx.fillStyle = simple ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.6)'
      ctx.fill()
      star(ctx, cx2, cy2, 10 * S, 4.4 * S)
      ctx.fillStyle = simple ? '#7d8799' : '#5b667d'
      ctx.fill()
    } else {
      drawTile(gx, gy, hx(BOARD_PALETTE.track))
    }
  })

  // home lanes: plain colour tiles, a faint chevron toward the centre
  for (const color of COLORS) {
    const [dx, dy] = HOME_DIR[color]
    HOME_LANES[color].forEach(([gx, gy]) => {
      drawTile(gx, gy, simple ? rgba(COLOR_HEX[color], 0.96) : hx(COLOR_HEX[color]))
      const cx2 = (gx + 0.5) * cell
      const cy2 = (gy + 0.5) * cell
      if (simple) return
      ctx.save()
      ctx.translate(cx2, cy2)
      ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'
      ctx.lineWidth = 2.5 * S
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-6 * S, 3.5 * S)
      ctx.lineTo(0, -4 * S)
      ctx.lineTo(6 * S, 3.5 * S)
      ctx.stroke()
      ctx.restore()
    })
  }

  // -------- centre --------
  const tri = [
    ['red', [6, 6], [6, 9]],
    ['green', [6, 6], [9, 6]],
    ['yellow', [9, 6], [9, 9]],
    ['blue', [6, 9], [9, 9]],
  ]
  for (const [color, a, b] of tri) {
    ctx.beginPath()
    ctx.moveTo(a[0] * cell, a[1] * cell)
    ctx.lineTo(C, C)
    ctx.lineTo(b[0] * cell, b[1] * cell)
    ctx.closePath()
    const g = ctx.createLinearGradient(a[0] * cell, a[1] * cell, C, C)
    g.addColorStop(0, hx(COLOR_HEX[color]))
    g.addColorStop(1, hx(COLOR_LIGHT[color]))
    ctx.fillStyle = simple ? hx(COLOR_HEX[color]) : g
    ctx.fill()
  }
  // raised medallion
  if (!simple) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = 16 * S
    ctx.shadowOffsetY = 4 * S
    ctx.beginPath()
    ctx.arc(C, C, 0.9 * cell, 0, 7)
    const med = ctx.createRadialGradient(C - 6 * S, C - 8 * S, 4 * S, C, C, cell)
    med.addColorStop(0, '#fff7dd')
    med.addColorStop(1, '#e8b64a')
    ctx.fillStyle = med
    ctx.fill()
    ctx.restore()
    ctx.beginPath()
    ctx.arc(C, C, 0.9 * cell, 0, 7)
    ctx.strokeStyle = '#c9902f'
    ctx.lineWidth = 3 * S
    ctx.stroke()
    star(ctx, C, C, 0.5 * cell, 0.22 * cell)
    ctx.fillStyle = '#8a5a12'
    ctx.fill()
  }

  // outer frame
  ctx.restore() // undo clip
  if (!simple) {
    rr(ctx, 1.5 * S, 1.5 * S, size - 3 * S, size - 3 * S, 29 * S)
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 3 * S
    ctx.stroke()
  }

  return cv
}
