// Landing on an opponent: which pawns get sent home, the knock-back / fly-home
// sequence, the elemental burst that goes with it, plus the shared particle
// textures and the generic pop burst.
import Phaser from 'phaser'
import { EASE, dur, prefersReducedMotion } from '../../ui/tokens.js'
import { sfx } from '../../audio.js'
import { COLOR_HEX, SAFE_STOPS } from '@ludo/engine'

export const CombatMixin = {
  collectCaptures(movedPawn) {
    const cell = this.getPawnCell(movedPawn)
    if (!cell || cell.type !== 'track' || SAFE_STOPS.has(cell.index)) return []
    const captured = []
    this.pawns.forEach((pawn) => {
      if (pawn === movedPawn || pawn.color === movedPawn.color || pawn.steps < 0 || pawn.finished) return
      const other = this.getPawnCell(pawn)
      if (other?.type === 'track' && other.index === cell.index) {
        if (this.shieldedColors.has(pawn.color)) {
          this.shieldedColors.delete(pawn.color)
          this.shieldExpiresOnOwnRoll.delete(pawn.color)
          this.updateShieldVisuals()
          this.playShieldBlock(pawn)
          return
        }
        captured.push({ pawn })
      }
    })
    return captured
  },

  playCaptureSequence(attacker, captured, onComplete) {
    this.phase = 'capture'
    this.captureCounts[attacker.color] += captured.length
    const attackerView = this.pawnViews.get(attacker)

    let pending = captured.length
    captured.forEach(({ pawn }, index) => {
      this.time.delayedCall(index * 200, () => {
        const victimView = this.pawnViews.get(pawn)
        pawn.steps = -1
        pawn.finished = false
        const home = this.getPawnPixel(pawn)
        this.kickPawn(attacker.color, attackerView, pawn.color, victimView, home, () => {
          pending--
          if (pending === 0) onComplete?.()
        })
      })
    })
  },

  // The attacker pawn winds up and slams into the victim; the victim is booted
  // off its square and cartwheels home. Shared by Classic and online play.
  kickPawn(attackerColor, attackerView, victimColor, victimView, home, onDone) {
    const to = home || (victimView && { x: victimView.x, y: victimView.y })
    if (!victimView || !to) { onDone?.(); return }

    if (!attackerView || prefersReducedMotion || this._behind) {
      // no attacker on hand (or reduced motion / catching up) - just send it home
      this.playElementalSkill?.(attackerColor, victimView.x, victimView.y)
      sfx.capture()
      const vBase = victimView.getData('stackScale') ?? 1
      this.tweens.add({
        targets: victimView, x: to.x, y: to.y, scale: vBase, angle: 0,
        duration: dur(this._behind ? 110 : 300), ease: 'Back.easeOut',
        onComplete: () => { victimView.setDepth(20); this.popAt(to.x, to.y, COLOR_HEX[victimColor]); onDone?.() },
      })
      return
    }

    const A = { x: attackerView.x, y: attackerView.y }
    const hit = { x: victimView.x, y: victimView.y }
    let nx = hit.x - A.x
    let ny = hit.y - A.y
    const d = Math.hypot(nx, ny) || 1
    nx /= d; ny /= d
    const spin = nx >= 0 ? 1 : -1

    attackerView.setDepth(44)
    this.tweens.killTweensOf(attackerView)
    this.tweens.chain({
      targets: attackerView,
      onComplete: () => attackerView.setDepth(20),
      tweens: [
        { x: A.x - nx * 11, y: A.y - ny * 11, duration: dur(100), ease: 'Sine.easeOut' },
        {
          x: A.x + nx * (d * 0.5), y: A.y + ny * (d * 0.5), duration: dur(75), ease: 'Quad.easeIn',
          onComplete: () => this.kickImpact(attackerColor, hit, nx, ny, spin, victimColor, victimView, to, onDone),
        },
        { x: A.x, y: A.y, duration: dur(230), ease: 'Back.easeOut' },
      ],
    })
  },

  kickImpact(attackerColor, at, nx, ny, spin, victimColor, victimView, home, onDone) {
    sfx.capture()
    sfx.buzz?.([14, 36, 16])
    this.cameras.main.shake(dur(130), 0.007)

    const shock = this.add.circle(at.x, at.y, 10, 0xffffff, 0).setStrokeStyle(6, 0xffffff, 0.95).setDepth(58)
    this.tweens.add({ targets: shock, radius: 54, alpha: 0, duration: dur(300), ease: EASE.out, onComplete: () => shock.destroy() })
    const shock2 = this.add.circle(at.x, at.y, 6, COLOR_HEX[attackerColor], 0).setStrokeStyle(4, COLOR_HEX[attackerColor], 0.85).setDepth(57)
    this.tweens.add({ targets: shock2, radius: 42, alpha: 0, duration: dur(380), delay: dur(50), ease: EASE.out, onComplete: () => shock2.destroy() })
    this.playElementalSkill?.(attackerColor, at.x, at.y)
    this.popAt(at.x, at.y, 0xffffff)

    victimView.setDepth(56)
    const vBase = victimView.getData('stackScale') ?? 1
    const kb = { x: at.x + nx * 54, y: at.y + ny * 54 - 36 }
    const mid = {
      x: (kb.x + home.x) / 2 + Phaser.Math.Between(-18, 18),
      y: Math.min(kb.y, home.y) - 96,
    }
    this.tweens.chain({
      targets: victimView,
      onComplete: () => {
        victimView.setAngle(0).setScale(vBase).setDepth(20)
        this.popAt(home.x, home.y, COLOR_HEX[victimColor])
        onDone?.()
      },
      tweens: [
        { x: kb.x, y: kb.y, angle: spin * 150, scale: vBase * 1.12, duration: dur(200), ease: 'Quad.easeOut' },
        { x: mid.x, y: mid.y, angle: spin * 470, duration: dur(280), ease: 'Sine.easeIn' },
        { x: home.x, y: home.y, angle: spin * 720, scale: vBase, duration: dur(300), ease: 'Back.easeOut' },
      ],
    })
  },

  playElementalSkill(color, x, y) {
    const config = {
      red: { tex: 'fx-flame', tint: [0xff3b1f, 0xff9a1f, 0xffd85e], count: 20, ring: 0xff5c28 },
      blue: { tex: 'fx-drop', tint: [0x3bb8ff, 0x86e9ff, 0xffffff], count: 22, ring: 0x4dc9ff },
      green: { tex: 'fx-leaf', tint: [0x49d66d, 0x9be15d, 0xe2d2a2], count: 18, ring: 0x62d66f },
      yellow: { tex: 'fx-bolt', tint: [0xffd533, 0xffffff, 0xff9f1c], count: 20, ring: 0xffdf4a },
    }[color]

    const ring = this.add.circle(x, y, 8, config.ring, 0).setStrokeStyle(4, config.ring, 0.75).setDepth(45)
    this.tweens.add({
      targets: ring,
      radius: 46,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    })
    this.add.particles(x, y, config.tex, {
      speed: { min: 95, max: 245 },
      angle: { min: 0, max: 360 },
      rotate: { min: -180, max: 180 },
      scale: { start: 1, end: 0 },
      lifespan: 450,
      quantity: config.count,
      emitting: false,
      tint: config.tint,
    }).setDepth(44).explode(config.count, x, y)
  },

  makeElementalEffectTextures() {
    if (!this.textures.exists('fx-flame')) {
      const g = this.make.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillTriangle(8, 0, 16, 20, 0, 20)
      g.fillTriangle(8, 5, 13, 20, 3, 20)
      g.generateTexture('fx-flame', 16, 22)

      g.clear()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(7, 10, 7)
      g.fillTriangle(7, 0, 13, 11, 1, 11)
      g.generateTexture('fx-drop', 14, 18)

      g.clear()
      g.fillStyle(0xffffff, 1)
      g.fillEllipse(10, 7, 18, 11)
      g.lineStyle(2, 0xffffff, 1)
      g.lineBetween(3, 11, 17, 3)
      g.generateTexture('fx-leaf', 20, 14)

      g.clear()
      g.fillStyle(0xffffff, 1)
      g.fillTriangle(8, 0, 2, 13, 8, 12)
      g.fillTriangle(8, 12, 3, 26, 16, 8)
      g.generateTexture('fx-bolt', 18, 28)
      g.destroy()
    }
  },

  popAt(x, y, color) {
    if (!this.textures.exists('classic-spark')) {
      const g = this.make.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(6, 6, 6)
      g.generateTexture('classic-spark', 12, 12)
      g.destroy()
    }
    this.add.particles(x, y, 'classic-spark', {
      speed: { min: 90, max: 230 },
      scale: { start: 1, end: 0 },
      lifespan: 380,
      quantity: 16,
      emitting: false,
      tint: [color, 0xffffff, 0xffd85e],
    }).explode(16, x, y)
  },
}
