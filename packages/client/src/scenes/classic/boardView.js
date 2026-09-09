// Static scene chrome: backdrop, top bar, the board itself (yards, track,
// centre), the per-quadrant colour wash and the bottom action bar.
import { W, H } from '../../config.js'
import { sfx } from '../../audio.js'
import { store } from '../../store.js'
import { t } from '../../i18n.js'
import { COLORS, COLOR_LIGHT, YARDS } from '@ludo/engine'
import { TILE, BOARD_SIZE, BOARD_X, BOARD_Y, BAR_Y } from './constants.js'
import { buildBoardCanvas } from './boardArt.js'

export const BoardViewMixin = {
  createBackdrop() {
    if (this.cleanBackdrop) return
    const g = this.add.graphics()
    g.fillStyle(0x060b22, 0.18)
    g.fillRect(0, 0, W, H)
    g.fillStyle(0xffffff, 0.03)
    g.fillCircle(110, 150, 120)
    g.fillCircle(620, 1150, 140)
  },

  // Top strip: leave button on the left, coin count on the right.
  createTopBar() {
    this._confirmLeave = false
    const y = 46
    this.makeRoundedRectTexture('topbtn', 50, 50, 0x243c54, 0x172b40, 15, 0x46647c)
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

    this.makeRoundedRectTexture('coin-pill', 132, 46, 0x172b40, 0x142438, 23, 0x46647c)
    const pillX = W - 44 - 66
    this.add.image(pillX, y, 'coin-pill').setDepth(6).setAlpha(0.96)
    this.add.circle(pillX - 42, y, 14, 0xffcf3f).setStrokeStyle(2, 0xffe9a3).setDepth(7)
    this.add.text(pillX - 42, y - 1, '★', { fontSize: 14, color: '#8a5a00' }).setOrigin(0.5).setDepth(8)
    this.coinText = this.add.text(pillX - 18, y - 1, store.coins.toLocaleString(), {
      fontFamily: 'Verdana, sans-serif', fontSize: 17, color: '#ffe27a', fontStyle: 'bold',
    }).setOrigin(0, 0.5).setDepth(8)
  },

  createBoard() {
    this.boardLayer = this.add.container(0, 0).setDepth(2)

    const boardTexture = this.simpleBoardStyle ? 'board-simple-flat' : 'board-v2'
    if (!this.textures.exists(boardTexture)) {
      this.textures.addCanvas(boardTexture, buildBoardCanvas({ simple: this.simpleBoardStyle }))
    }
    const cx = BOARD_X + BOARD_SIZE / 2
    const cy = BOARD_Y + BOARD_SIZE / 2
    const board = this.add.image(cx, cy, boardTexture).setDisplaySize(BOARD_SIZE, BOARD_SIZE)
    // the online scene rotates the whole board so the local player sits bottom-left
    const rot = (this._boardRot | 0) % 4
    // online mode sits flat on the arena: no drop shadow behind the board
    if (this.simpleBoardStyle) {
      if (rot) board.setAngle(rot * 90)
      this.boardLayer.add(board)
    } else {
      // drop shadow so the board sits ON the arena
      const shadow = this.add.image(cx, cy + 8, boardTexture).setDisplaySize(BOARD_SIZE, BOARD_SIZE)
        .setTint(0x000000).setAlpha(0.35)
      if (rot) { shadow.setAngle(rot * 90); board.setAngle(rot * 90) }
      this.boardLayer.add([shadow, board])
    }

    this.createQuadrantFx()
  },

  // A rounded colour glow over each home quadrant that pulses on that player's
  // turn so it's unmistakable whose move it is.
  createQuadrantFx() {
    this.quadFx = {}
    COLORS.forEach((color) => {
      const [bx, by] = YARDS[color].box
      const c = this.gridToPixel(bx + 3, by + 3)
      const w = TILE * 6
      const x = c.x - w / 2
      const y = c.y - w / 2
      const g = this.add.graphics().setDepth(3).setAlpha(0)
      g.fillStyle(COLOR_LIGHT[color], this.simpleBoardStyle ? 0.12 : 0.3)
      g.fillRoundedRect(x + 4, y + 4, w - 8, w - 8, 24)
      g.lineStyle(this.simpleBoardStyle ? 3 : 6, COLOR_LIGHT[color], this.simpleBoardStyle ? 0.65 : 0.95)
      g.strokeRoundedRect(x + 5, y + 5, w - 10, w - 10, 22)
      this.quadFx[color] = g
    })
  },

  createBottomBar() {
    if (this.plainBottomBar) {
      this.createPowerButtons()
      return
    }
    this.makeRoundedRectTexture('bottom-bar', W + 40, 108, 0x1d3249, 0x101f32, 30, 0x3d5870)
    this.add.image(W / 2, BAR_Y + 26, 'bottom-bar').setAlpha(0.98).setDepth(38)
    this.add.rectangle(W / 2, BAR_Y - 28, W - 48, 3, 0xffffff, 0.12).setDepth(39)
    this.createPowerButtons()
  },
}
