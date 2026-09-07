import Phaser from 'phaser'
import { W, H } from '../config.js'
import { DUR, EASE, dur, prefersReducedMotion } from './tokens.js'

// Shared visual/interaction helpers for every scene in the app.
export class UIScene extends Phaser.Scene {
  // ---------- motion primitives ----------
  // Every entrance/exit in the app should go through one of these so timing
  // and easing stay consistent. All honour prefers-reduced-motion via dur().

  // Scale + fade a target in from `from` scale. Returns the tween.
  popIn(target, { from = 0.6, delay = 0, duration = DUR.base, onComplete } = {}) {
    target.setScale(from)
    if (target.setAlpha) target.setAlpha(0)
    return this.tweens.add({
      targets: target,
      scale: target.getData?.('baseScale') ?? 1,
      alpha: 1,
      delay: dur(delay),
      duration: dur(duration),
      ease: EASE.pop,
      onComplete,
    })
  }

  popOut(target, { to = 0.7, duration = DUR.fast, onComplete } = {}) {
    return this.tweens.add({
      targets: target,
      scale: to,
      alpha: 0,
      duration: dur(duration),
      ease: EASE.out,
      onComplete: () => {
        onComplete?.()
      },
    })
  }

  // Slide + fade in from an offset (dx,dy). Good for bars and panels.
  slideIn(target, { dx = 0, dy = 24, delay = 0, duration = DUR.entrance, onComplete } = {}) {
    const x = target.x
    const y = target.y
    target.setPosition(x + dx, y + dy)
    if (target.setAlpha) target.setAlpha(0)
    return this.tweens.add({
      targets: target,
      x,
      y,
      alpha: 1,
      delay: dur(delay),
      duration: dur(duration),
      ease: EASE.out,
      onComplete,
    })
  }

  // Cascade a list of targets in with a per-item stagger.
  enterStagger(targets, { dx = 0, dy = 20, step = 60, duration = DUR.base, delay = 0 } = {}) {
    targets.forEach((t, i) => this.slideIn(t, { dx, dy, delay: delay + i * step, duration }))
  }

  // A single quick "notice me" bounce.
  pulseOnce(target, { scale = 1.12, duration = DUR.base } = {}) {
    if (prefersReducedMotion) return
    const base = target.getData?.('baseScale') ?? 1
    this.tweens.add({
      targets: target,
      scale: { from: base * scale, to: base },
      duration: dur(duration),
      ease: EASE.pop,
    })
  }

  // Tween a number in a Text object from its current value to `to`.
  countUp(textObj, to, { duration = DUR.slow, format = (n) => `${Math.round(n)}`, onComplete } = {}) {
    const from = parseFloat(String(textObj.text).replace(/[^0-9.-]/g, '')) || 0
    if (prefersReducedMotion || from === to) {
      textObj.setText(format(to))
      onComplete?.()
      return
    }
    const state = { v: from }
    this.tweens.add({
      targets: state,
      v: to,
      duration: dur(duration),
      ease: EASE.out,
      onUpdate: () => textObj.setText(format(state.v)),
      onComplete: () => {
        textObj.setText(format(to))
        onComplete?.()
      },
    })
  }

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
    const base = animateTarget.getData?.('baseScale') ?? 1
    const to = (m) => this.tweens.add({
      targets: animateTarget, scale: base * m, duration: dur(90), ease: EASE.out,
    })
    zone.on('pointerover', () => to(1.04))
    zone.on('pointerout', () => to(1))
    zone.on('pointerdown', () => to(0.93))
    zone.on('pointerup', () => {
      this.tweens.add({
        targets: animateTarget,
        scale: { from: base * 0.93, to: base },
        duration: dur(220),
        ease: EASE.pop,
      })
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
    if (this._leaving) return
    this._leaving = true
    const ms = dur(220)
    this.cameras.main.fadeOut(ms, 8, 6, 24)
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(sceneKey, data))
  }

  // Standard scene-in: fade the camera up from the app's deep background.
  enterScene() {
    this.cameras.main.fadeIn(dur(260), 8, 6, 24)
  }
}
