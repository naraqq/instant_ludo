// Landing on an opponent: which pawns get sent home, the knock-back / fly-home
// sequence, the elemental burst that goes with it, plus the shared particle
// textures and the generic pop burst.
import Phaser from 'phaser'
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
    sfx.capture()
    sfx.buzz([16, 40, 24])

    const attackerView = this.pawnViews.get(attacker)
    const attackerScale = attackerView.getData('stackScale') ?? 1
    this.tweens.add({
      targets: attackerView,
      scale: attackerScale * 1.22,
      duration: 120,
      yoyo: true,
      ease: 'Back.easeOut',
    })

    let pending = captured.length
    captured.forEach(({ pawn }, index) => {
      this.time.delayedCall(index * 130, () => {
        const victim = this.pawnViews.get(pawn)
        const start = { x: victim.x, y: victim.y }
        this.playElementalSkill(attacker.color, victim.x, victim.y)
        this.cameras.main.shake(130, 0.0025)
        pawn.steps = -1
        pawn.finished = false
        const home = this.getPawnPixel(pawn)
        const mid = {
          x: start.x + (home.x - start.x) * 0.42 + Phaser.Math.Between(-35, 35),
          y: Math.min(start.y, home.y) - 95,
        }
        victim.setDepth(55)
        this.tweens.add({
          targets: victim,
          x: start.x + Phaser.Math.Between(-28, 28),
          y: start.y - 54,
          angle: Phaser.Math.Between(-24, 24),
          scale: (victim.getData('stackScale') ?? 1) * 1.08,
          duration: 190,
          ease: 'Cubic.easeOut',
          onComplete: () => {
            this.tweens.add({
              targets: victim,
              x: mid.x,
              y: mid.y,
              angle: Phaser.Math.Between(-18, 18),
              duration: 280,
              ease: 'Sine.easeInOut',
              onComplete: () => {
                this.tweens.add({
                  targets: victim,
                  x: home.x,
                  y: home.y,
                  angle: 0,
                  scale: victim.getData('stackScale') ?? 1,
                  duration: 330,
                  ease: 'Back.easeOut',
                  onComplete: () => {
                    victim.setDepth(20)
                    this.popAt(home.x, home.y, COLOR_HEX[pawn.color])
                    pending--
                    if (pending === 0) onComplete?.()
                  },
                })
              },
            })
          },
        })
      })
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
