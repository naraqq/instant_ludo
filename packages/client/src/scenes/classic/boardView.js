// Static scene chrome: backdrop, top bar, the board itself (yards, track,
// centre), the per-quadrant colour wash and the bottom action bar.
import { W, H } from '../../config.js'
import { sfx } from '../../audio.js'
import { store } from '../../store.js'
import { t } from '../../i18n.js'
import {
  COLORS,
  COLOR_HEX,
  COLOR_DARK,
  COLOR_LIGHT,
  COLOR_SURFACE,
  BOARD_PALETTE,
  SAFE_STOPS,
  HOME_LANES,
  YARDS,
  TRACK,
} from '@ludo/engine'
import { TILE, BOARD_SIZE, BOARD_X, BOARD_Y, BOARD_BOTTOM, BAR_Y, START_OWNER } from './constants.js'

export const BoardViewMixin = {
  createBackdrop() {
    const g = this.add.graphics()
    g.fillStyle(0x060b22, 0.18)
    g.fillRect(0, 0, W, H)
    g.fillStyle(0xffffff, 0.03)
    g.fillCircle(110, 150, 120)
    g.fillCircle(620, 1150, 140)
  },

  // Top strip: leave button on the left, coin count on the right.
  createTopBar() {
    const y = 46
    this.makeRoundedRectTexture('topbtn', 50, 50, 0x3b2c78, 0x2a1e5c, 15, 0x6a58b8)
    const back = this.add.image(44, y, 'topbtn').setDepth(6).setAlpha(0.96)
    this.add.text(44, y - 1, '‹', {
      fontFamily: 'Verdana, sans-serif', fontSize: 26, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(7)
    this.addPressFeedback(this.makeHitZone(44, y, 52, 52), back, () => {
      sfx.tap()
      if (this.gameOver) {
        this.goTo('Home')
        return
      }
      if (this._confirmLeave) {
        this.goTo('Home')
        return
      }
      this._confirmLeave = true
      this.showToast(t('classic.leaveConfirm'))
      this.time.delayedCall(2500, () => { this._confirmLeave = false })
    })

    this.makeRoundedRectTexture('coin-pill', 132, 46, 0x2a1e5c, 0x211748, 23, 0x6a58b8)
    const pillX = W - 44 - 66
    this.add.image(pillX, y, 'coin-pill').setDepth(6).setAlpha(0.96)
    this.add.circle(pillX - 42, y, 14, 0xffcf3f).setStrokeStyle(2, 0xffe9a3).setDepth(7)
    this.add.text(pillX - 42, y - 1, '★', { fontSize: 14, color: '#8a5a00' }).setOrigin(0.5).setDepth(8)
    this.coinText = this.add.text(pillX - 18, y - 1, store.coins.toLocaleString(), {
      fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#ffe27a', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(8)
  },

  createBoard() {
    const boardSize = BOARD_SIZE
    this.boardLayer = this.add.container(0, 0).setDepth(2)
    this._boardExtras = []

    // full-bleed board: just soft edge accents top & bottom
    this.boardLayer.add([
      this.add.rectangle(W / 2, BOARD_Y - 3, W, 6, 0x000000, 0.32),
      this.add.rectangle(W / 2, BOARD_BOTTOM + 3, W, 6, 0x000000, 0.32),
      this.add.rectangle(W / 2, BOARD_Y + 1, W, 2, 0xffffff, 0.25),
    ])

    const g = this.add.graphics()
    g.fillStyle(0xffffff, 1)
    g.fillRect(BOARD_X, BOARD_Y, boardSize, boardSize)
    COLORS.forEach((color) => this.drawYard(g, color))
    TRACK.forEach(([gx, gy], i) => {
      const owner = START_OWNER[i]
      const fill = owner ? COLOR_HEX[owner] : SAFE_STOPS.has(i) ? BOARD_PALETTE.safe : BOARD_PALETTE.track
      this.drawSquare(g, gx, gy, fill, 1, null, { safe: SAFE_STOPS.has(i), owner })
    })
    Object.entries(HOME_LANES).forEach(([color, cells]) => {
      cells.forEach(([gx, gy]) => this.drawSquare(g, gx, gy, COLOR_HEX[color], 1, color))
    })
    this.drawCenter(g)
    this.boardLayer.add(g)
    this.boardLayer.add(this._boardExtras)
    this._boardExtras = null

    this.createQuadrantFx()
  },

  // A colour wash + bright inset border over each home quadrant. Both pulse hard
  // on that player's turn so it's unmistakable whose move it is.
  createQuadrantFx() {
    this.quadFx = {}
    COLORS.forEach((color) => {
      const [bx, by] = YARDS[color].box
      const c = this.gridToPixel(bx + 3, by + 3)
      const rect = this.add
        .rectangle(c.x, c.y, TILE * 6, TILE * 6, COLOR_LIGHT[color], 0)
        .setStrokeStyle(7, COLOR_LIGHT[color], 0)
        .setDepth(3) // just above the board art, under gates / runes / pawns
      this.quadFx[color] = rect
    })
  },

  drawYard(g, color) {
    const [gx, gy] = YARDS[color].box
    const centre = this.gridToPixel(gx + 3, gy + 3)
    const x = centre.x - TILE * 3
    const y = centre.y - TILE * 3
    g.fillStyle(COLOR_HEX[color], 1)
    g.fillRect(x, y, TILE * 6, TILE * 6)
    g.fillGradientStyle(COLOR_LIGHT[color], COLOR_HEX[color], COLOR_HEX[color], COLOR_DARK[color], 1)
    g.fillRect(x, y, TILE * 6, TILE * 6)
    g.lineStyle(2, COLOR_DARK[color], .4)
    g.strokeRect(x + 1, y + 1, TILE * 6 - 2, TILE * 6 - 2)
    g.fillStyle(COLOR_DARK[color], .3)
    g.fillRoundedRect(x + TILE + 4, y + TILE + 7, TILE * 4, TILE * 4, 18)
    g.fillStyle(COLOR_SURFACE[color], 1)
    g.fillRoundedRect(x + TILE, y + TILE, TILE * 4, TILE * 4, 18)
    g.lineStyle(3, 0xffffff, .9)
    g.strokeRoundedRect(x + TILE, y + TILE, TILE * 4, TILE * 4, 18)
    this.yardSlots(color).forEach(([px, py]) => {
      const p = this.gridToPixel(px, py + 0.28)
      g.fillStyle(COLOR_HEX[color], .16)
      g.fillEllipse(p.x, p.y, 34, 14)
    })
  },

  drawSquare(g, gx, gy, color, alpha = 1, laneColor, opts = {}) {
    const centre = this.gridToPixel(gx + 0.5, gy + 0.5)
    const x = centre.x - TILE / 2
    const y = centre.y - TILE / 2
    g.fillStyle(color, alpha)
    g.fillRect(x, y, TILE, TILE)
    if (laneColor) {
      g.fillStyle(COLOR_LIGHT[laneColor], 0.18)
      g.fillRect(x, y, TILE, 4)
      g.fillStyle(COLOR_DARK[laneColor], 0.18)
      g.fillRect(x, y + TILE - 4, TILE, 4)
      g.lineStyle(2, COLOR_DARK[laneColor], 0.5)
      g.strokeRect(x, y, TILE, TILE)
    } else if (opts.owner) {
      g.fillStyle(0xffffff, 0.22)
      g.fillRect(x, y, TILE, 5)
      g.fillStyle(COLOR_DARK[opts.owner], 0.28)
      g.fillRect(x, y + TILE - 5, TILE, 5)
      g.lineStyle(2.5, COLOR_DARK[opts.owner], 0.62)
      g.strokeRect(x, y, TILE, TILE)
    } else if (opts.safe) {
      g.fillStyle(0xffffff, 0.18)
      g.fillRect(x, y, TILE, 5)
      g.fillStyle(0x000000, 0.08)
      g.fillRect(x, y + TILE - 5, TILE, 5)
      g.lineStyle(1.75, BOARD_PALETTE.grid, 0.62)
      g.strokeRect(x, y, TILE, TILE)
    } else {
      g.lineStyle(1.75, BOARD_PALETTE.grid, 0.62)
      g.strokeRect(x, y, TILE, TILE)
    }
    if (opts.safe) {
      this._boardExtras?.push(this.add.text(x + TILE / 2, y + TILE / 2, '★', {
        fontFamily: 'Verdana, sans-serif',
        fontSize: 18,
        color: opts.owner ? '#ffffff' : '#3f4756',
        fontStyle: 'bold',
      }).setOrigin(0.5).setAlpha(opts.owner ? 0.95 : 0.8))
    }
  },

  drawCenter(g) {
    const C = this.gridToPixel(7.5, 7.5)
    const cx = C.x
    const cy = C.y
    const tl = this.gridToPixel(6, 6)
    const tr = this.gridToPixel(9, 6)
    const bl = this.gridToPixel(6, 9)
    const br = this.gridToPixel(9, 9)
    g.fillStyle(COLOR_HEX.red, 1)
    g.fillTriangle(tl.x, tl.y, cx, cy, bl.x, bl.y)
    g.fillStyle(COLOR_HEX.green, 1)
    g.fillTriangle(tl.x, tl.y, cx, cy, tr.x, tr.y)
    g.fillStyle(COLOR_HEX.yellow, 1)
    g.fillTriangle(tr.x, tr.y, cx, cy, br.x, br.y)
    g.fillStyle(COLOR_HEX.blue, 1)
    g.fillTriangle(bl.x, bl.y, cx, cy, br.x, br.y)
    this._boardExtras?.push(this.add.text(cx, cy, '★', {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 34,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#00000033', 4))
  },

  createBottomBar() {
    this.makeRoundedRectTexture('bottom-bar', W + 40, 108, 0x271c58, 0x1a1140, 30, 0x4c3d94)
    this.add.image(W / 2, BAR_Y + 26, 'bottom-bar').setAlpha(0.98).setDepth(38)
    this.add.rectangle(W / 2, BAR_Y - 28, W - 48, 3, 0xffffff, 0.12).setDepth(39)
    this.createPowerButtons()
  },
}
