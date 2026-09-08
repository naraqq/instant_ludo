// The dice roll: the tumbling 3D die in the corner tray, the fire-power second
// die, landing, pity-six bookkeeping, and handing off to the move phase (auto-
// playing the roll when only one move is legal). Plus the flat dice textures.
import Phaser from 'phaser'
import { prefersReducedMotion } from '../../ui/tokens.js'
import { sfx } from '../../audio.js'
import { dicePose, drawDice, drawRestingDice } from '../../ui/dice3d.js'
import { COLOR_HEX } from '../board.js'
import { POD, SIX_PITY_LIMIT } from './constants.js'

export const DiceMixin = {
  rollDice() {
    if (this.phase !== 'roll' || this.gameOver) return
    this.clearExtraRollCue(this.currentColor)
    this.phase = 'rolling'
    this.stopTurnTimer()
    sfx.roll()
    sfx.buzz(12)
    const color = this.currentColor
    if (this.shieldedColors.has(color) && this.shieldExpiresOnOwnRoll.has(color)) {
      this.shieldedColors.delete(color)
      this.shieldExpiresOnOwnRoll.delete(color)
      this.updateShieldVisuals()
    }
    const dice = this.cornerDice[color]
    const tray = dice.container
    const trayY = POD[color].dy
    const forcedValue = this.forcedDiceValue
    const guaranteedSix = this.sixForced.has(color)
    const doubleActive = this.doubleNextRoll
    this.forcedDiceValue = null
    this.doubleNextRoll = false
    const rawValue = forcedValue ?? (guaranteedSix ? 6 : Phaser.Math.Between(1, 6))
    const target = dicePose(rawValue)
    const start = { ...dice.pose }
    const progress = { t: 0 }
    let landed = false
    // The fire power rolls two dice that tumble independently but always come
    // to rest on the same face - render a mirrored second die alongside the first.
    const spread = doubleActive ? 44 : 0
    let pose2 = { ...start }
    dice.face2.setVisible(doubleActive)
    dice.shadow2.setVisible(doubleActive)
    if (!doubleActive) {
      dice.face.setPosition(0, -1)
      dice.shadow.setPosition(2, 25)
    }
    this.tweens.killTweensOf(tray)
    this.tweens.killTweensOf(dice.glow)
    tray.setVisible(true).setAlpha(1).setScale(1).setAngle(0).setY(trayY)
    dice.glow.setVisible(false).setAlpha(0).setScale(1)
    const impact = () => {
      if (landed) return
      landed = true
      sfx.land(rawValue)
      sfx.buzz(rawValue === 6 ? 28 : 14)
      if (!prefersReducedMotion) {
        this.popAt(tray.x, tray.y + 20, rawValue === 6 || doubleActive ? 0xffd54d : COLOR_HEX[color])
      }
    }
    this.tweens.add({
      targets: progress,
      t: 1,
      duration: prefersReducedMotion ? 100 : 650,
      ease: 'Linear',
      onUpdate: () => {
        const t = progress.t
        let height = 0
        let squash = 0
        let modelScale = 1
        if (prefersReducedMotion) {
          dice.pose = target
          pose2 = target
        } else if (t < .1) {
          squash = Math.sin(t / .1 * Math.PI / 2) * .14
        } else if (t < .76) {
          const flight = (t - .1) / .66
          const rotation = 1 - Math.pow(1 - flight, 2)
          dice.pose = {
            x: start.x + (target.x + Math.PI * 4 - start.x) * rotation,
            y: start.y + (target.y + Math.PI * 4 - start.y) * rotation,
            tilt: Math.sin(flight * Math.PI),
          }
          // Extra whole turns for the second die so the pair tumbles out of sync
          // yet still resolves to the same resting face.
          pose2 = {
            x: start.x + (target.x + Math.PI * 6 - start.x) * rotation,
            y: start.y + (target.y - Math.PI * 4 - start.y) * rotation,
            tilt: Math.sin(flight * Math.PI),
          }
          const lift = Math.sin(flight * Math.PI)
          height = lift * 42
          modelScale = 1 + lift * .5
        } else {
          dice.pose = target
          pose2 = target
          impact()
          const settle = (t - .76) / .24
          height = Math.sin(settle * Math.PI) * 4
          squash = Math.cos(settle * Math.PI * 3) * (1 - settle) * .1
        }
        const wobble = Math.sin(t * Math.PI * 2) * (height / 12)
        const paintDie = (g, poseObj, baseX, wob) => {
          g.setPosition(baseX + wob, -1 - height)
            .setScale(modelScale * (1 + squash), modelScale * (1 - squash))
          if (prefersReducedMotion || t < .1) {
            drawRestingDice(g, dice.value)
          } else if (t >= .76) {
            drawRestingDice(g, rawValue)
          } else {
            drawDice(g, poseObj)
          }
        }
        paintDie(dice.face, dice.pose, -spread, wobble)
        dice.shadow.setPosition(2 - spread, 25).setScale(1 - height / 130, 1 - height / 170)
          .setAlpha(.3 - height / 260)
        if (doubleActive) {
          paintDie(dice.face2, pose2, spread, -wobble)
          dice.shadow2.setPosition(2 + spread, 25).setScale(1 - height / 130, 1 - height / 170)
            .setAlpha(.3 - height / 260)
        }
      },
      onComplete: () => {
        dice.pose = target
        dice.value = rawValue
        dice.face.setPosition(-spread, -1).setScale(1)
        dice.shadow.setPosition(2 - spread, 25).setScale(1).setAlpha(.3)
        drawRestingDice(dice.face, rawValue)
        if (doubleActive) {
          dice.face2.setVisible(true).setPosition(spread, -1).setScale(1)
          dice.shadow2.setVisible(true).setPosition(2 + spread, 25).setScale(1).setAlpha(.3)
          drawRestingDice(dice.face2, rawValue)
        }
        impact()
        this.rawDiceValue = rawValue
        this.diceValue = doubleActive ? rawValue * 2 : rawValue
        // "1-in-N" pity: never more than SIX_PITY_LIMIT non-sixes in a row
        if (rawValue === 6) {
          this.sixPity[color] = 0
          this.sixForced.delete(color)
        } else {
          this.sixPity[color]++
          if (this.sixPity[color] >= SIX_PITY_LIMIT) this.sixForced.add(color)
        }
        this.phase = 'move'
        this.refreshTurnUI()
        this.updatePowerButtons()
        const resolved = this.onRollResolved
        this.onRollResolved = null
        const moves = this.getMovesForCurrentPlayer()
        if (moves.length === 0) {
          this.time.delayedCall(750, () => this.nextTurn())
        } else if (this.isBot(color)) {
          this.time.delayedCall(480, () => resolved && resolved())
        } else if (moves.length === 1) {
          // Only one legal move - play it for the human after a beat so they
          // still see what they rolled.
          this.time.delayedCall(prefersReducedMotion ? 120 : 460, () => {
            const only = this.getMovesForCurrentPlayer()
            if (only.length === 1 && this.phase === 'move' && !this.gameOver) {
              this.tryMovePawn(only[0])
            } else if (this.phase === 'move') {
              this.startTurnTimer('move')
            }
          })
        } else {
          this.startTurnTimer('move')
        }
      },
    })
  },

  makeDiceTextures() {
    for (let face = 1; face <= 6; face++) {
      const key = `dice-${face}`
      if (this.textures.exists(key)) continue
      const size = 74
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      const gradient = ctx.createLinearGradient(0, 0, 0, size)
      gradient.addColorStop(0, '#fff8e8')
      gradient.addColorStop(1, '#ffd260')
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'
      ctx.beginPath()
      ctx.roundRect(7, 9, 58, 58, 14)
      ctx.fill()
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.roundRect(4, 3, 60, 60, 14)
      ctx.fill()
      ctx.lineWidth = 4
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      const spots = {
        1: [[34, 33]],
        2: [[22, 21], [46, 45]],
        3: [[22, 21], [34, 33], [46, 45]],
        4: [[22, 21], [46, 21], [22, 45], [46, 45]],
        5: [[22, 21], [46, 21], [34, 33], [22, 45], [46, 45]],
        6: [[22, 20], [46, 20], [22, 33], [46, 33], [22, 46], [46, 46]],
      }[face]
      ctx.fillStyle = '#3c2b12'
      spots.forEach(([x, y]) => {
        ctx.beginPath()
        ctx.arc(x, y, 5, 0, Math.PI * 2)
        ctx.fill()
      })
      this.textures.addCanvas(key, canvas)
    }
  },
}
