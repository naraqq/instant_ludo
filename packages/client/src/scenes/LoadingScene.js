import Phaser from 'phaser'
import { W, H } from '../config.js'
import { EASE, prefersReducedMotion } from '../ui/tokens.js'

const GAME_FONT = '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif'
const MIN_VISIBLE_MS = 1600
const ELEMENTS = [
  { key: 'fire', color: 0xff513d },
  { key: 'water', color: 0x2698ff },
  { key: 'earth', color: 0x24cf79 },
  { key: 'air', color: 0xffc52e },
]

export class LoadingScene extends Phaser.Scene {
  constructor() {
    super('Loading')
  }

  init() {
    this.startedAt = performance.now()
    this.displayProgress = { value: 0 }
  }

  preload() {
    this.createBackground()
    this.createBrand()
    this.createProgress()

    // Load the lobby art here so the polished loading screen covers the only
    // noticeable first-launch asset fetch. HomeScene safely skips cached files.
    ELEMENTS.forEach(({ key }) => {
      this.load.image(`hero-${key}`, `assets/sprites/pawn-${key}.png`)
      this.load.image(`hero-${key}-sm`, `assets/sprites/pawn-${key}-sm.png`)
      this.load.image(`rune-${key}`, `assets/sprites/rune-${key}.png`)
    })

    this.load.on('progress', value => {
      // Reserve the final part of the bar for the short ready animation.
      this.setProgress(Math.min(.88, value * .88))
    })
  }

  create() {
    this.orbs.forEach(orb => {
      orb.getData('glyph').setVisible(false)
      orb.add(this.add.image(0, 31, `hero-${orb.getData('key')}-sm`).setOrigin(.5, 1).setScale(.56))
    })

    const elapsed = performance.now() - this.startedAt
    const remaining = Math.max(420, MIN_VISIBLE_MS - elapsed - 220)
    this.tweens.add({
      targets: this.displayProgress,
      value: 1,
      duration: remaining,
      ease: 'Sine.easeInOut',
      onUpdate: () => this.setProgress(this.displayProgress.value),
      onComplete: () => {
        this.statusText.setText('READY!').setColor('#fff45a')
        this.pulseLogo()
        this.time.delayedCall(170, () => {
          this.cameras.main.fadeOut(220, 8, 18, 45)
          this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Home'))
        })
      },
    })

    if (!prefersReducedMotion) {
      this.orbs.forEach((orb, i) => {
        this.tweens.add({
          targets: orb, y: orb.y - 10, duration: 700 + i * 110,
          yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: i * 90,
        })
      })
    }
  }

  createBackground() {
    const key = 'loading-bg-candy'
    if (!this.textures.exists(key)) {
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      const gradient = ctx.createLinearGradient(0, 0, 0, H)
      gradient.addColorStop(0, '#29467f')
      gradient.addColorStop(.48, '#152b59')
      gradient.addColorStop(1, '#071329')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, W, H)
      const glow = ctx.createRadialGradient(W / 2, H * .42, 20, W / 2, H * .42, W * .55)
      glow.addColorStop(0, 'rgba(91,175,255,.24)')
      glow.addColorStop(1, 'rgba(20,37,80,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)
      this.textures.addCanvas(key, canvas)
    }
    this.add.image(W / 2, H / 2, key)

    const rays = this.add.graphics().setPosition(W / 2, H * .42)
    for (let i = 0; i < 14; i++) {
      const angle = (Math.PI * 2 * i) / 14
      const spread = .045
      rays.fillStyle(0xa8d7ff, i % 2 ? .025 : .045)
      rays.beginPath()
      rays.moveTo(0, 0)
      rays.lineTo(Math.cos(angle - spread) * 410, Math.sin(angle - spread) * 410)
      rays.lineTo(Math.cos(angle + spread) * 410, Math.sin(angle + spread) * 410)
      rays.closePath().fillPath()
    }
  }

  createBrand() {
    const cy = H * .39
    this.logo = this.add.container(W / 2, cy).setData('baseScale', 1)
    this.logo.add(this.add.text(0, -116, 'E L E M E N T A L', {
      fontFamily: GAME_FONT, fontSize: 20, color: '#c9ecff', fontStyle: 'bold',
      stroke: '#102656', strokeThickness: 4,
    }).setOrigin(.5))

    ;['L', 'U', 'D', 'O'].forEach((letter, i) => {
      const colors = ['#ff574b', '#27d489', '#2b9cff', '#ffc42f']
      this.logo.add(this.add.text(-111 + i * 74, -30, letter, {
        fontFamily: GAME_FONT, fontSize: 104, color: colors[i], fontStyle: 'bold',
        stroke: '#ffffff', strokeThickness: 4,
      }).setOrigin(.5).setShadow(0, 9, '#081538', 5, true, true))
    })

    this.logo.add(this.add.text(0, 54, 'FOUR ELEMENTS. ONE CROWN.', {
      fontFamily: GAME_FONT, fontSize: 16, color: '#ffffff', fontStyle: 'bold',
      stroke: '#102656', strokeThickness: 3,
    }).setOrigin(.5))

    this.orbs = ELEMENTS.map(({ key, color }, i) => {
      const x = W / 2 - 132 + i * 88
      const y = cy + 124
      const orb = this.add.container(x, y).setData('key', key)
      orb.add(this.add.circle(0, 6, 30, 0x050e26, .55))
      orb.add(this.add.circle(0, 0, 28, color).setStrokeStyle(4, 0xffffff, .72))
      const glyph = this.add.text(0, -1, ['×2', '●', '◆', '+1'][i], {
        fontFamily: GAME_FONT, fontSize: i === 1 ? 25 : 17, color: '#ffffff',
        fontStyle: 'bold', stroke: '#132250', strokeThickness: 3,
      }).setOrigin(.5)
      orb.add(glyph).setData('glyph', glyph)
      return orb
    })
  }

  createProgress() {
    const y = H * .70
    this.progressTrack = this.add.graphics()
    this.progressFill = this.add.graphics()
    this.add.text(W / 2, y - 58, 'PREPARING THE ELEMENTS', {
      fontFamily: GAME_FONT, fontSize: 17, color: '#cce7ff', fontStyle: 'bold',
      stroke: '#0b1b42', strokeThickness: 3,
    }).setOrigin(.5)
    this.statusText = this.add.text(W / 2, y + 50, 'LOADING…', {
      fontFamily: GAME_FONT, fontSize: 18, color: '#ffffff', fontStyle: 'bold',
      stroke: '#0b1b42', strokeThickness: 3,
    }).setOrigin(.5)
    this.setProgress(0)
  }

  setProgress(value) {
    value = Phaser.Math.Clamp(value, 0, 1)
    this.displayProgress.value = Math.max(this.displayProgress.value, value)
    const w = 500
    const h = 34
    const x = (W - w) / 2
    const y = H * .70
    this.progressTrack.clear()
    this.progressTrack.fillStyle(0x061531, .95).fillRoundedRect(x, y - h / 2, w, h, 17)
    this.progressTrack.lineStyle(4, 0x4e8ed7, 1).strokeRoundedRect(x, y - h / 2, w, h, 17)
    this.progressFill.clear()
    const fillW = Math.max(18, (w - 10) * this.displayProgress.value)
    this.progressFill.fillStyle(0x7df20d, 1).fillRoundedRect(x + 5, y - h / 2 + 5, fillW, h - 10, 12)
    this.progressFill.fillStyle(0xd4ff72, .65).fillRoundedRect(x + 10, y - h / 2 + 7, Math.max(8, fillW - 10), 6, 4)
    this.statusText?.setText(`${Math.round(this.displayProgress.value * 100)}%`)
  }

  pulseLogo() {
    if (prefersReducedMotion) return
    this.tweens.add({ targets: this.logo, scale: 1.06, duration: 110, yoyo: true, ease: EASE.pop })
  }
}
