// The dice roll: the tumbling 3D die in the corner tray, the fire-power second
// die, landing, pity-six bookkeeping, and handing off to the move phase (auto-
// playing the roll when only one move is legal). Plus the flat dice textures.
import Phaser from 'phaser'
import { prefersReducedMotion } from '../../ui/tokens.js'
import { SIX_PITY_LIMIT } from './constants.js'

export const DiceMixin = {
  rollDice() {
    if (this.phase !== 'roll' || this.gameOver) return
    // A gate rune must be chosen before rolling on - nudge the picker, don't roll.
    if (this._gatePickChoose && this._gatePickOwner === this.currentColor && !this.isBot(this.currentColor)) {
      this.bumpGatePicker()
      return
    }
    if (this._gatePickOwner === this.currentColor) {
      this.autoResolveGatePick() // bot / clock fallback only
    }
    this.clearExtraRollCue(this.currentColor)
    this.phase = 'rolling'
    this.stopTurnTimer()
    const color = this.currentColor
    if (this.shieldedColors.has(color) && this.shieldExpiresOnOwnRoll.has(color)) {
      this.shieldedColors.delete(color)
      this.shieldExpiresOnOwnRoll.delete(color)
      this.updateShieldVisuals()
    }
    const forcedValue = this.forcedDiceValue
    const guaranteedSix = this.sixForced.has(color)
    const doubleActive = this.doubleNextRoll
    this.forcedDiceValue = null
    this.doubleNextRoll = false
    const rawValue = forcedValue ?? (guaranteedSix ? 6 : Phaser.Math.Between(1, 6))

    // a Control-chosen value isn't a roll - snap the die onto it, no tumble
    this.animateDiceTumble(color, rawValue, { doubled: doubleActive, snap: forcedValue != null }).then(() => {
      this.rawDiceValue = rawValue
      this.diceValue = doubleActive ? rawValue * 2 : rawValue
      // "1-in-N" pity: never more than SIX_PITY_LIMIT non-sixes in a row
      if (rawValue === 6) {
        this.sixPity[color] = 0
        this.sixForced.delete(color)
        this.sixRun[color] = (this.sixRun[color] || 0) + 1
      } else {
        this.sixRun[color] = 0
        this.sixPity[color]++
        if (this.sixPity[color] >= SIX_PITY_LIMIT) this.sixForced.add(color)
      }

      // three sixes in a row: the third is void - no move, the turn passes
      if (rawValue === 6 && this.sixRun[color] >= 3) {
        this.sixRun[color] = 0
        this.rawDiceValue = 0
        this.diceValue = 0
        this.flashSixForfeit(color)
        this.refreshTurnUI()
        this.time.delayedCall(prefersReducedMotion ? 300 : 850, () => this.nextTurn())
        return
      }

      this.phase = 'move'
      this.refreshTurnUI()
      this.updatePowerButtons()
      const resolved = this.onRollResolved
      this.onRollResolved = null
      const moves = this.getMovesForCurrentPlayer()
      if (moves.length === 0) {
        this.time.delayedCall(prefersReducedMotion ? 250 : 560, () => this.nextTurn())
      } else if (this.isBot(color)) {
        this.time.delayedCall(320, () => resolved && resolved())
      } else if (moves.length === 1) {
        // Only one legal move - play it for the human after a beat so they
        // still see what they rolled.
        this.time.delayedCall(prefersReducedMotion ? 100 : 320, () => {
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
