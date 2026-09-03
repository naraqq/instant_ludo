import Phaser from 'phaser'
import { W, H } from '../config.js'
import { UIScene } from '../ui/UIScene.js'

// PixelDicePack (CC0, Outer Cloud Studio) - a fixed 8-col x 12-row sprite sheet.
// Columns alternate a 16x16 "big" tile and an 8x8 "small" tile per color; only the
// big tiles are used here. Rows 0-5 are faces 1-6 for one color group, rows 6-11
// repeat that for a second group. Grid measured directly off the PNG's pixel data.
const TILE = 16
const ROW_Y = [1, 18, 35, 52, 70, 87, 104, 121, 138, 155, 173, 190]
const BIG_COL_X = { red: 1, blue: 33, navy: 65, white: 97, yellow: 1, green: 33, purple: 65 }
const ROW_OFFSET = { red: 0, blue: 0, navy: 0, white: 0, yellow: 6, green: 6, purple: 6 }
const DICE_COLORS = Object.keys(BIG_COL_X)

export class PowerScene extends UIScene {
  constructor() {
    super('Power')
    this.rolling = false
  }

  preload() {
    this.makeBackgroundTexture('bg-power', '#2a1608', '#c97a2b')
    this.load.image('dice-sheet', 'assets/dice/PixelDicePack.png')
  }

  create() {
    this.registerDiceFrames()

    this.add.image(W / 2, H / 2, 'bg-power')

    this.createBackButton()
    this.createHeader()
    this.createDiceDemo()

    this.cameras.main.fadeIn(200, 0, 0, 0)
  }

  registerDiceFrames() {
    const texture = this.textures.get('dice-sheet')
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST)
    DICE_COLORS.forEach((color) => {
      for (let face = 1; face <= 6; face++) {
        const row = ROW_OFFSET[color] + (face - 1)
        texture.add(`${color}-${face}`, 0, BIG_COL_X[color], ROW_Y[row], TILE, TILE)
      }
    })
  }

  createBackButton() {
    const cx = 60
    const cy = 70
    const backZone = this.makeHitZone(cx, cy, 60, 60)
    const backBtn = this.add.circle(cx, cy, 26, 0x000000, 0.25).setStrokeStyle(2, 0xffffff55)
    this.add.text(cx, cy, '←', {
      fontFamily: 'Verdana, sans-serif', fontSize: 28, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5)
    this.addPressFeedback(backZone, backBtn, () => this.goTo('Home'))
  }

  createHeader() {
    this.add.text(W / 2, 170, 'POWER', {
      fontFamily: 'Verdana, sans-serif', fontSize: 56, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#00000040', 6)

    this.add.text(W / 2, 226, 'Fast dice battles', {
      fontFamily: 'Verdana, sans-serif', fontSize: 18, color: '#ffffffcc',
    }).setOrigin(0.5)
  }

  createDiceDemo() {
    this.diceShadow = this.add.ellipse(W / 2, 660, 160, 30, 0x000000, 0.3)

    this.diceImage = this.add.image(W / 2, 560, 'dice-sheet', 'red-1').setScale(14)

    this.resultText = this.add.text(W / 2, 760, 'Tap Roll to try the dice', {
      fontFamily: 'Verdana, sans-serif', fontSize: 20, color: '#ffffffcc',
    }).setOrigin(0.5)

    const rollW = 220
    const rollH = 70
    const rollY = 900
    this.makeRoundedRectTexture('roll-btn', rollW, rollH, 0xffd85e, 0xff9a2e, 35, 0xffedb0)
    const rollContainer = this.add.container(W / 2, rollY)
    rollContainer.add(this.add.image(0, 0, 'roll-btn'))
    rollContainer.add(
      this.add.text(0, 0, '🎲 Roll', {
        fontFamily: 'Verdana, sans-serif', fontSize: 24, color: '#3d2400', fontStyle: 'bold',
      }).setOrigin(0.5)
    )

    const rollZone = this.makeHitZone(W / 2, rollY, rollW, rollH)
    this.addPressFeedback(rollZone, rollContainer, () => this.rollDice())

    this.add.text(W / 2, H - 60, 'Full POWER mode is still in the works', {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#ffffff88',
    }).setOrigin(0.5)
  }

  rollDice() {
    if (this.rolling) return
    this.rolling = true
    this.resultText.setText('Rolling...')

    const color = Phaser.Utils.Array.GetRandom(DICE_COLORS)
    const totalTicks = 14
    let tick = 0

    // A quick hop while the face cycles, landing back down when it settles.
    this.tweens.add({
      targets: [this.diceImage, this.diceShadow],
      y: '-=40',
      duration: totalTicks * 55 * 0.4,
      yoyo: true,
      ease: 'Sine.easeInOut',
    })
    this.tweens.add({
      targets: this.diceShadow,
      scaleX: 0.7,
      scaleY: 0.7,
      alpha: 0.15,
      duration: totalTicks * 55 * 0.4,
      yoyo: true,
      ease: 'Sine.easeInOut',
    })

    this.time.addEvent({
      delay: 55,
      repeat: totalTicks - 1,
      callback: () => {
        tick++
        const face = Phaser.Math.Between(1, 6)
        this.diceImage.setTexture('dice-sheet', `${color}-${face}`)
        this.tweens.add({ targets: this.diceImage, angle: Phaser.Math.Between(-12, 12), duration: 50 })

        if (tick === totalTicks) {
          this.rolling = false
          this.resultText.setText(`You rolled a ${face}!`)
          this.tweens.add({
            targets: this.diceImage,
            angle: 0,
            scale: { from: 16, to: 14 },
            duration: 250,
            ease: 'Back.easeOut',
          })
          this.burst(this.diceImage.x, this.diceImage.y + 90, color)
        }
      },
    })
  }

  burst(x, y, color) {
    if (!this.textures.exists('spark')) {
      const g = this.make.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(6, 6, 6)
      g.generateTexture('spark', 12, 12)
      g.destroy()
    }
    const tint = {
      red: 0xea323c, blue: 0x0069aa, navy: 0x0e071b, white: 0xffffff,
      yellow: 0xffc825, green: 0x5ac54f, purple: 0x3b1443,
    }[color]

    this.add.particles(x, y, 'spark', {
      speed: { min: 60, max: 160 },
      scale: { start: 1, end: 0 },
      lifespan: 350,
      quantity: 12,
      emitting: false,
      tint,
    }).explode(12, x, y)
  }
}
