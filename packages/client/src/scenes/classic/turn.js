// Turn driver: legal-move checks, moving a pawn, advancing / skipping turns, the
// human turn timer, bot autoplay, and the end-game / victory overlay.
import Phaser from 'phaser'
import { W, H } from '../../config.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../../ui/tokens.js'
import { sfx } from '../../audio.js'
import { store } from '../../store.js'
import { chooseAiMove, chooseAiPower, bestForcedDice } from '@ludo/engine'
import { t } from '../../i18n.js'
import { COLOR_HEX } from '@ludo/engine'
import { TILE, BOARD_Y, TURN_SECONDS } from './constants.js'

export const TurnMixin = {
  advanceTurn() {
    this.currentPlayer = (this.currentPlayer + 1) % this.activeColors.length
  },

  tryMovePawn(pawn) {
    if (this.phase !== 'move' || this.gameOver || pawn.color !== this.currentColor || !this.canMove(pawn)) return
    this.phase = 'moving'
    this.stopTurnTimer()
    this.updatePawnHighlights()
    this.updatePowerButtons()
    const from = pawn.steps
    const to = pawn.steps === -1 ? 0 : pawn.steps + this.diceValue
    pawn.steps = to
    if (pawn.steps >= 56) {
      pawn.finished = true
      pawn.steps = 56
    }
    this._gatePass = this.moveCrossesGate(pawn.color, from, pawn.steps)
    this.animatePawn(pawn, from, pawn.steps, () => {
      // Kick off the gate rune pick, but don't wait on it - the turn plays on
      // and a human resolves the picker over the top of the ongoing game.
      this.resolveGatePass(pawn)
      // Landing on a "+1" rune grants this player an extra roll.
      this.collectBonusRune(pawn)

      const captured = this.collectCaptures(pawn)
      const finishTurn = () => {
        if (pawn.finished) {
          this.popAt(W / 2, BOARD_Y + TILE * 7.5, COLOR_HEX[pawn.color])
          sfx.rune()
          this.markPawnHome(pawn)
        }
        this.checkForWinner(pawn.color)
        if (this.gameOver) return
        this.phase = 'roll'
        const extraReason = this.extraRollNextTurn ? 'air'
          : captured.length > 0 ? 'capture'
            : pawn.finished ? 'finish' : this.rawDiceValue === 6 ? 'six' : null
        if (!extraReason) this.advanceTurn()
        // Only arm the shield's expiry when the turn actually passes - a bonus
        // roll is a continuation of this turn, so the shield must survive it.
        if (!extraReason && this.shieldedColors.has(pawn.color)) this.shieldExpiresOnOwnRoll.add(pawn.color)
        this.extraRollNextTurn = false
        this.diceValue = 0
        this.rawDiceValue = 0
        this.refreshTurnUI()
        if (extraReason) this.showExtraRollCue(pawn.color, extraReason)
        this.reflowPawns(true)
        this.time.delayedCall(360, () => this.beginTurn())
      }

      if (captured.length > 0) {
        this.playCaptureSequence(pawn, captured, finishTurn)
      } else {
        finishTurn()
      }
    })
  },

  canMove(pawn) {
    if (pawn.finished) return false
    if (pawn.steps === -1) return this.rawDiceValue === 6 || this.diceValue === 6
    return pawn.steps + this.diceValue <= 56
  },

  getMovesForCurrentPlayer() {
    const color = this.currentColor
    return this.pawns.filter((pawn) => pawn.color === color && this.canMove(pawn))
  },

  nextTurn() {
    if (this.gameOver) return
    const color = this.currentColor
    const extraReason = this.extraRollNextTurn ? 'air' : this.rawDiceValue === 6 ? 'six' : null
    this.phase = 'roll'
    if (!extraReason) this.advanceTurn()
    if (!extraReason && this.shieldedColors.has(color)) this.shieldExpiresOnOwnRoll.add(color)
    this.extraRollNextTurn = false
    this.diceValue = 0
    this.rawDiceValue = 0
    this.refreshTurnUI(t('classic.noMove'))
    if (extraReason) this.showExtraRollCue(color, extraReason)
    this.time.delayedCall(320, () => this.beginTurn())
  },

  // ---------- turn driver (human timer / bot autoplay) ----------

  beginTurn() {
    if (this.gameOver || this.phase !== 'roll') return
    const color = this.currentColor
    // An air rune banked from a gate becomes this turn's bonus roll.
    if (this.pendingExtraRoll.has(color)) {
      this.pendingExtraRoll.delete(color)
      this.extraRollNextTurn = true
      this.showExtraRollCue(color, 'air')
    }
    if (this.isBot(color)) {
      this.time.delayedCall(560, () => this.runBotTurn())
    } else {
      this.startTurnTimer('roll')
    }
  },

  buildAiState() {
    const color = this.currentColor
    return {
      color,
      dice: this.diceValue || 0,
      raw: this.rawDiceValue || 0,
      pawns: this.pawns.map((p) => ({ color: p.color, id: p.id, steps: p.steps, finished: p.finished })),
      shielded: new Set(this.shieldedColors),
      inventory: { ...this.powerInventory[color] },
      difficulty: this.difficulty,
    }
  },

  runBotTurn() {
    if (this.gameOver || this.phase !== 'roll') return
    const color = this.currentColor
    const inv = this.powerInventory[color]
    const powerKey = chooseAiPower(this.buildAiState())

    if (powerKey === 'water' && inv.water > 0) {
      this.forcedDiceValue = bestForcedDice(this.buildAiState())
      inv.water--
      sfx.power()
      this.playPowerEffect(color, 'water')
    } else if (powerKey === 'fire' && inv.fire > 0) {
      this.doubleNextRoll = true
      inv.fire--
      sfx.power()
      this.playPowerEffect(color, 'fire')
    } else if (powerKey === 'earth' && inv.earth > 0) {
      inv.earth--
      this.shieldedColors.add(color)
      this.shieldExpiresOnOwnRoll.delete(color)
      this.playShieldAura(color)
      this.updateShieldVisuals()
      sfx.power()
      this.playPowerEffect(color, 'earth')
    }
    this.updatePowerButtons()

    this.onRollResolved = () => this.runBotMove()
    this.time.delayedCall(powerKey ? 460 : 140, () => this.rollDice())
  },

  runBotMove() {
    if (this.gameOver || this.phase !== 'move') return
    const choice = chooseAiMove(this.buildAiState())
    if (!choice) {
      this.nextTurn()
      return
    }
    const pawn = this.pawns.find((p) => p.color === choice.color && p.id === choice.id)
    this.time.delayedCall(420, () => {
      if (pawn && !this.gameOver) this.tryMovePawn(pawn)
    })
  },

  startTurnTimer(kind) {
    this.stopTurnTimer()
    if (this.gameOver || this.isBot(this.currentColor)) return
    const total = kind === 'move' ? 20 : TURN_SECONDS
    this.turnSecondsLeft = total
    this.turnSecondsTotal = total
    this.drawTimerArc(1)
    this.turnTimer = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => {
        this.turnSecondsLeft -= 0.25
        this.drawTimerArc(Math.max(this.turnSecondsLeft, 0) / this.turnSecondsTotal)
        if (this.turnSecondsLeft <= 0) {
          this.stopTurnTimer()
          this.handleTurnTimeout()
        }
      },
    })
  },

  stopTurnTimer() {
    if (this.turnTimer) {
      this.turnTimer.remove(false)
      this.turnTimer = null
    }
    Object.values(this.playerBadges || {}).forEach((b) => b.getByName('arc')?.clear())
  },

  handleTurnTimeout() {
    if (this.gameOver) return
    this.showToast(t('classic.timeUp'))
    if (this.phase === 'roll') {
      this.rollDice()
    } else if (this.phase === 'move') {
      const moves = this.getMovesForCurrentPlayer()
      if (moves.length) this.tryMovePawn(Phaser.Utils.Array.GetRandom(moves))
      else this.nextTurn()
    }
  },

  // ---------- win flow ----------

  checkForWinner(color) {
    const allHome = this.pawns.filter((p) => p.color === color).every((p) => p.finished)
    if (!allHome || this.finishOrder.includes(color)) return
    this.finishOrder.push(color)
    this.endGame()
  },

  progressOf(color) {
    return this.pawns
      .filter((p) => p.color === color)
      .reduce((sum, p) => sum + Math.max(p.steps, 0), 0)
  },

  endGame() {
    if (this.gameOver) return
    this.activeColors.forEach(color => this.clearExtraRollCue(color))
    this.gameOver = true
    this.stopTurnTimer()
    this.closeGatePicker()
    this.clearActivePawnZones()
    this.phase = 'over'
    const winner = this.finishOrder[0]
    const youWon = winner === this.youColor

    const ranking = [...this.activeColors].sort((a, b) => {
      if (a === winner) return -1
      if (b === winner) return 1
      return this.progressOf(b) - this.progressOf(a)
    })

    const reward = this.applyRewards(youWon)
    if (youWon || !this.youColor) sfx.win()
    else sfx.lose()
    sfx.buzz(youWon ? [30, 40, 30, 40, 70] : 70)
    this.cameras.main.shake(300, youWon ? 0.004 : 0.002)
    this.time.delayedCall(450, () => this.showVictoryOverlay(winner, youWon, ranking, reward))
  },

  applyRewards(youWon) {
    if (!this.youColor) return null
    const captures = this.captureCounts[this.youColor] || 0
    const coins = (youWon ? 500 : 90) + captures * 12
    const xp = youWon ? 120 : 35
    const levels = store.addXp(xp)
    store.addCoins(coins)
    store.recordGame({ won: youWon, captures })
    return { coins, xp, levels, captures, won: youWon }
  },

  showVictoryOverlay(winner, youWon, ranking, reward) {
    const cardW = 520
    const cardH = 616
    const layer = this.add.container(0, 0).setDepth(200)
    layer.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05060f, 0.74))
    layer.add(this.add.zone(W / 2, H / 2, W, H).setInteractive())

    this.makeRoundedRectTexture('victory-card', cardW, cardH, 0x2a1f52, 0x140d2c, 28, COLOR_HEX[winner])
    const card = this.add.container(W / 2, H / 2, [this.add.image(0, 0, 'victory-card').setAlpha(0.98)])

    const winColor = t(`color.${winner}`)
    const heading = youWon ? t('victory.youWin') : this.youColor ? t('victory.defeat') : t('victory.colorWins', { color: winColor })
    card.add(this.add.text(0, -cardH / 2 + 66, heading, {
      fontFamily: 'Verdana, sans-serif', fontSize: 46, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#00000055', 6))
    card.add(this.add.text(0, -cardH / 2 + 112, t('victory.allHome', { color: winColor }), {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#c9b8ff',
    }).setOrigin(0.5))

    const medals = [t('victory.place1'), t('victory.place2'), t('victory.place3'), t('victory.place4')]
    this.makeRoundedRectTexture('victory-row', cardW - 72, 50, 0x392b6b, 0x2a1f52, 12)
    const rows = []
    ranking.forEach((color, i) => {
      const row = this.add.container(0, -cardH / 2 + 168 + i * 60)
      row.add(this.add.image(0, 0, 'victory-row'))
      row.add(this.add.circle(-cardW / 2 + 58, 0, 14, COLOR_HEX[color]))
      row.add(this.add.text(-cardW / 2 + 88, 0, medals[i], {
        fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0, 0.5))
      const name = color === this.youColor
        ? t('classic.you').toUpperCase()
        : this.isBot(color) ? t('victory.bot', { color: t(`color.${color}`) }) : t(`color.${color}`)
      row.add(this.add.text(-cardW / 2 + 142, 0, name, {
        fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#d9ccff',
      }).setOrigin(0, 0.5))
      const finished = this.pawns.filter((p) => p.color === color && p.finished).length
      row.add(this.add.text(cardW / 2 - 54, 0, t('victory.home4', { n: finished }), {
        fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#a99cd6',
      }).setOrigin(1, 0.5))
      card.add(row)
      rows.push(row)
    })
    // cascade the placement rows in after the card lands
    if (!prefersReducedMotion) {
      rows.forEach((r, i) => {
        r.setAlpha(0).setX(-40)
        this.tweens.add({ targets: r, alpha: 1, x: 0, delay: dur(360 + i * 80), duration: dur(DUR.base), ease: EASE.out })
      })
    }

    let ry = -cardH / 2 + 168 + ranking.length * 60 + 34
    if (reward) {
      const rewardStart = dur(400 + ranking.length * 80)
      const rewardText = this.add.text(0, ry, t('victory.reward', { c: 0, x: 0 }), {
        fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#ffe27a', fontStyle: 'bold',
      }).setOrigin(0.5)
      card.add(rewardText)
      const rs = { c: 0, x: 0 }
      this.tweens.add({
        targets: rs, c: reward.coins, x: reward.xp,
        delay: rewardStart, duration: dur(DUR.slow), ease: EASE.out,
        onUpdate: () => rewardText.setText(t('victory.reward', { c: Math.round(rs.c).toLocaleString(), x: Math.round(rs.x) })),
        onComplete: () => {
          rewardText.setText(t('victory.reward', { c: reward.coins.toLocaleString(), x: reward.xp }))
          this.pulseOnce(rewardText, { scale: 1.14 })
        },
      })
      if (reward.captures) {
        card.add(this.add.text(0, ry + 26, t('victory.captureBonus', { n: reward.captures * 12, k: reward.captures }), {
          fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#c9b8ff',
        }).setOrigin(0.5))
      }
      if (reward.levels > 0) {
        card.add(this.add.text(0, ry + 52, t('victory.levelUp', { n: store.level }), {
          fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#7cffb2', fontStyle: 'bold',
        }).setOrigin(0.5))
      }
    } else {
      card.add(this.add.text(0, ry, t('victory.noRewards'), {
        fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#a99cd6',
      }).setOrigin(0.5))
    }

    const by = cardH / 2 - 68
    this.makeRoundedRectTexture('victory-btn-primary', 214, 62, 0x34c759, 0x1f9d43, 16, 0x9affc0)
    this.makeRoundedRectTexture('victory-btn-ghost', 214, 62, 0x3a2c66, 0x2a2050, 16, 0x6a5aa8)
    const rematch = this.add.container(-116, by, [
      this.add.image(0, 0, 'victory-btn-primary'),
      this.add.text(0, 0, t('victory.rematch'), { fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#08240f', fontStyle: 'bold' }).setOrigin(0.5),
    ])
    const home = this.add.container(116, by, [
      this.add.image(0, 0, 'victory-btn-ghost'),
      this.add.text(0, 0, t('victory.home'), { fontFamily: 'Verdana, sans-serif', fontSize: 19, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5),
    ])
    card.add([rematch, home])
    layer.add(card)

    card.setScale(0.82).setAlpha(0)
    this.tweens.add({ targets: card, scale: 1, alpha: 1, duration: 340, ease: 'Back.easeOut' })

    this.makeHitZone(W / 2 - 116, H / 2 + by, 214, 62).setDepth(300)
      .on('pointerup', () => {
        sfx.tap()
        this.cameras.main.fadeOut(200, 0, 0, 0)
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart(this.lastConfig))
      })
    this.makeHitZone(W / 2 + 116, H / 2 + by, 214, 62).setDepth(300)
      .on('pointerup', () => {
        sfx.tap()
        this.goTo('Home')
      })

    this.victoryConfetti(winner)
  },

  victoryConfetti(winner) {
    if (!this.textures.exists('classic-spark')) {
      const g = this.make.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(6, 6, 6)
      g.generateTexture('classic-spark', 12, 12)
      g.destroy()
    }
    this.add.particles(W / 2, -20, 'classic-spark', {
      x: { min: 0, max: W },
      speedY: { min: 130, max: 340 },
      speedX: { min: -70, max: 70 },
      scale: { start: 1.5, end: 0.4 },
      rotate: { min: 0, max: 360 },
      lifespan: 2800,
      quantity: 3,
      frequency: 45,
      duration: 2400,
      tint: [COLOR_HEX[winner], 0xffffff, 0xffd85e, 0x7cffb2],
    }).setDepth(260)
  },
}
