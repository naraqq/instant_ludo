import Phaser from 'phaser'
import { W, H } from '../config.js'

// Shared visual/interaction helpers for every scene in the app.
export class UIScene extends Phaser.Scene {
  makeBackgroundTexture(key, topColor, bottomColor) {
    if (this.textures.exists(key)) return
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')

    const gradient = ctx.createLinearGradient(0, 0, 0, H)
    gradient.addColorStop(0, topColor)
    gradient.addColorStop(1, bottomColor)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, W, H)

    for (let i = 0; i < 50; i++) {
      const x = Phaser.Math.Between(0, W)
      const y = Phaser.Math.Between(0, H * 0.6)
      const r = Phaser.Math.FloatBetween(0.5, 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${Phaser.Math.FloatBetween(0.2, 0.9)})`
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    this.textures.addCanvas(key, canvas)
  }

  // Phaser's Graphics.generateTexture rasterizes via the Canvas API, which does not
  // support fillGradientStyle (WebGL-only) - so gradients are baked by hand here instead.
  makeRoundedRectTexture(key, w, h, colorTop, colorBottom, radius, strokeColor) {
    if (this.textures.exists(key)) return
    const toCss = (n) => `#${n.toString(16).padStart(6, '0')}`
    const r = Math.min(radius, w / 2, h / 2)
    const inset = strokeColor !== undefined ? 1.5 : 0

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')

    ctx.beginPath()
    ctx.moveTo(inset + r, inset)
    ctx.arcTo(w - inset, inset, w - inset, h - inset, r)
    ctx.arcTo(w - inset, h - inset, inset, h - inset, r)
    ctx.arcTo(inset, h - inset, inset, inset, r)
    ctx.arcTo(inset, inset, w - inset, inset, r)
    ctx.closePath()

    if (colorBottom !== undefined && colorBottom !== colorTop) {
      const gradient = ctx.createLinearGradient(0, 0, 0, h)
      gradient.addColorStop(0, toCss(colorTop))
      gradient.addColorStop(1, toCss(colorBottom))
      ctx.fillStyle = gradient
    } else {
      ctx.fillStyle = toCss(colorTop)
    }
    ctx.fill()

    if (strokeColor !== undefined) {
      ctx.lineWidth = 3
      ctx.strokeStyle = toCss(strokeColor)
      ctx.stroke()
    }

    this.textures.addCanvas(key, canvas)
  }

  // Containers with a custom Geom.Rectangle hitArea misfire on unrelated objects in this
  // Phaser 4.2.1 release, so input lives on a plain invisible Zone (a well-tested default
  // hit-test path) instead, while the visual container just gets animated by it.
  makeHitZone(cx, cy, w, h) {
    return this.add.zone(cx, cy, w, h).setInteractive({ useHandCursor: true })
  }

  addPressFeedback(zone, animateTarget, onClick) {
    zone.on('pointerover', () => this.tweens.add({ targets: animateTarget, scale: 1.04, duration: 100 }))
    zone.on('pointerout', () => this.tweens.add({ targets: animateTarget, scale: 1, duration: 100 }))
    zone.on('pointerdown', () => this.tweens.add({ targets: animateTarget, scale: 0.94, duration: 80 }))
    zone.on('pointerup', () => {
      this.tweens.add({ targets: animateTarget, scale: 1.04, duration: 100 })
      onClick?.()
    })
  }

  showToast(message) {
    if (this.toast) {
      this.tweens.killTweensOf(this.toast)
      this.toast.destroy()
    }
    const padding = 20
    const label = this.add.text(0, 0, message, {
      fontFamily: 'Verdana, sans-serif',
      fontSize: 18,
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5)

    const w = label.width + padding * 2
    const h = label.height + padding
    const key = `toast-bg-${w}x${h}`
    this.makeRoundedRectTexture(key, w, h, 0x1b2a4a, 0x1b2a4a, h / 2, 0xffffff)
    const bg = this.add.image(0, 0, key).setAlpha(0.95)

    const toast = this.add.container(W / 2, H / 2, [bg, label]).setAlpha(0).setScale(0.9)
    toast.setDepth(1000)
    this.toast = toast

    this.tweens.add({
      targets: toast,
      alpha: 1,
      scale: 1,
      duration: 180,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.time.delayedCall(1100, () => {
          this.tweens.add({ targets: toast, alpha: 0, scale: 0.9, duration: 220, onComplete: () => toast.destroy() })
        })
      },
    })
  }

  goTo(sceneKey, data) {
    this.cameras.main.fadeOut(200, 0, 0, 0)
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(sceneKey, data))
  }
}
