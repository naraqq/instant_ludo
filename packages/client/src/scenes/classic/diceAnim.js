// The purely-visual dice tumble: the 3D die (and the fire power's mirrored second
// die) leaping out of the corner tray and settling on a face. Shared by the
// Classic scene (local roll) and the online scene (replaying a server roll) so
// the two can never drift apart. Callers own every bit of game bookkeeping
// (pity-six, phase changes, auto-moves) - this file only animates.
import { prefersReducedMotion } from '../../ui/tokens.js'
import { sfx } from '../../audio.js'
import { dicePose, drawDice, drawRestingDice } from '../../ui/dice3d.js'
import { COLOR_HEX } from '@ludo/engine'
import { POD } from './constants.js'

export const DiceAnimMixin = {
  // Drop the corner die straight onto `rawValue`, no tumble. Used when the
  // online scene is replaying a backlog of turns and needs to catch up.
  restDice(color, rawValue, { doubled = false } = {}) {
    const dice = this.cornerDice?.[color]
    if (!dice) return
    dice.pose = dicePose(rawValue)
    dice.value = rawValue
    dice.face2.setVisible(doubled)
    dice.shadow2.setVisible(doubled)
    const spread = doubled ? 44 : 0
    dice.face.setPosition(-spread, -1).setScale(1)
    drawRestingDice(dice.face, rawValue)
    if (doubled) {
      dice.face2.setPosition(spread, -1).setScale(1)
      drawRestingDice(dice.face2, rawValue)
    }
  },

  // A short "wind-up" shake in the tray, held until the server tells us the
  // value (~one round trip). It bridges the wait so the die reacts on tap, then
  // animateDiceTumble() plays the real, full roll - identical to local play.
  // Returns { stop }.
  diceWindup(color, { doubled = false } = {}) {
    const dice = this.cornerDice?.[color]
    if (!dice) return { stop() {} }
    const tray = dice.container
    const spread = doubled ? 44 : 0
    dice.face2.setVisible(doubled)
    dice.shadow2.setVisible(doubled)
    this.tweens.killTweensOf(tray)
    tray.setVisible(true).setAlpha(1).setScale(1).setAngle(0).setY((this.podFor?.(color) ?? POD[color]).dy)
    dice.glow.setVisible(false).setAlpha(0)
    sfx.buzz?.(10) // tap feedback; the roll whoosh fires when the real tumble starts
    const base = { ...dice.pose }
    let k = 0
    const timer = this.time.addEvent({
      delay: 16, loop: true,
      callback: () => {
        k += 1
        const jitter = prefersReducedMotion ? 0 : 1
        const p = {
          x: base.x + Math.sin(k * 0.9) * 0.28 * jitter,
          y: base.y + Math.cos(k * 1.1) * 0.28 * jitter,
          tilt: 1,
        }
        const hop = Math.abs(Math.sin(k * 0.5)) * 5 * jitter
        const paint = (g, bx) => {
          drawDice(g, p)
          g.setPosition(bx, -1 - hop).setScale(1 + hop * 0.01, 1 - hop * 0.012)
        }
        paint(dice.face, -spread)
        dice.shadow.setPosition(2 - spread, 25).setScale(1 - hop / 60).setAlpha(0.3 - hop / 90)
        if (doubled) {
          paint(dice.face2, spread)
          dice.shadow2.setPosition(2 + spread, 25).setScale(1 - hop / 60).setAlpha(0.3 - hop / 90)
        }
      },
    })
    return {
      stop() {
        timer.remove(false)
        dice.pose = { ...base }
        dice.face.setScale(1)
        if (doubled) dice.face2.setScale(1)
      },
    }
  },

  // Tumble `this.cornerDice[color]` to `rawValue`; resolves when it lands.
  // `instant`: no visuals at all (catch-up). `snap`: the value was chosen, not
  // rolled - drop it in with a bounce and a pop, no tumble.
  animateDiceTumble(color, rawValue, { doubled = false, instant = false, snap = false } = {}) {
    const dice = this.cornerDice?.[color]
    if (!dice) return Promise.resolve()
    if (instant) { this.restDice(color, rawValue, { doubled }); return Promise.resolve() }
    if (snap) {
      this.restDice(color, rawValue, { doubled })
      if (prefersReducedMotion) return Promise.resolve()
      const t = dice.container
      dice.face.setScale(1.28)
      if (doubled) dice.face2.setScale(1.28)
      this.tweens.add({ targets: [dice.face, dice.face2], scaleX: 1, scaleY: 1, duration: 240, ease: 'Back.easeOut' })
      this.popAt?.(t.x, t.y + 20, COLOR_HEX[color])
      sfx.land?.(rawValue)
      sfx.buzz?.(14)
      return new Promise((r) => this.time.delayedCall(260, r))
    }

    const tray = dice.container
    const trayY = (this.podFor?.(color) ?? POD[color]).dy
    const target = dicePose(rawValue)
    const start = { ...dice.pose }
    const progress = { t: 0 }
    let landed = false
    // The fire power rolls two dice that tumble out of sync but rest on the
    // same face - render a mirrored second die alongside the first.
    const spread = doubled ? 44 : 0
    let pose2 = { ...start }
    dice.face2.setVisible(doubled)
    dice.shadow2.setVisible(doubled)
    if (!doubled) {
      dice.face.setPosition(0, -1)
      dice.shadow.setPosition(2, 25)
    }
    this.tweens.killTweensOf(tray)
    this.tweens.killTweensOf(dice.glow)
    tray.setVisible(true).setAlpha(1).setScale(1).setAngle(0).setY(trayY)
    dice.glow.setVisible(false).setAlpha(0).setScale(1)
    sfx.roll?.()
    sfx.buzz?.(12)

    const impact = () => {
      if (landed) return
      landed = true
      sfx.land?.(rawValue)
      sfx.buzz?.(rawValue === 6 ? 28 : 14)
      if (!prefersReducedMotion) {
        this.popAt(tray.x, tray.y + 20, rawValue === 6 || doubled ? 0xffd54d : COLOR_HEX[color])
      }
    }

    return new Promise((resolve) => {
      this.tweens.add({
        targets: progress,
        t: 1,
        duration: prefersReducedMotion ? 90 : 430,
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
          if (doubled) {
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
          if (doubled) {
            dice.face2.setVisible(true).setPosition(spread, -1).setScale(1)
            dice.shadow2.setVisible(true).setPosition(2 + spread, 25).setScale(1).setAlpha(.3)
            drawRestingDice(dice.face2, rawValue)
          }
          impact()
          resolve()
        },
      })
    })
  },
}
