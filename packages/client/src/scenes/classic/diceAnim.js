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

  // Start the die tumbling in place before we know the result (the online scene
  // spins the instant you tap, then settles when the server's value arrives, so
  // the tap feels as immediate as local play). Returns { stop }.
  spinDice(color, { doubled = false } = {}) {
    const dice = this.cornerDice?.[color]
    if (!dice) return { stop() {} }
    const tray = dice.container
    const spread = doubled ? 44 : 0
    dice.face2.setVisible(doubled)
    dice.shadow2.setVisible(doubled)
    this.tweens.killTweensOf(tray)
    tray.setVisible(true).setAlpha(1).setScale(1).setAngle(0).setY(POD[color].dy)
    dice.glow.setVisible(false).setAlpha(0)
    sfx.roll?.()
    sfx.buzz?.(12)
    const pose = { ...dice.pose, tilt: 1 }
    const pose2 = { ...dice.pose, tilt: 1 }
    const lift = 34
    const paint = (g, p, baseX) => {
      drawDice(g, p)
      g.setPosition(baseX, -1 - lift).setScale(1.35, 1.35)
    }
    const timer = this.time.addEvent({
      delay: 16, loop: true,
      callback: () => {
        pose.x += 0.38; pose.y += 0.52
        paint(dice.face, pose, -spread)
        dice.shadow.setPosition(2 - spread, 25).setScale(0.8).setAlpha(0.16)
        if (doubled) {
          pose2.x += 0.3; pose2.y -= 0.42
          paint(dice.face2, pose2, spread)
          dice.shadow2.setPosition(2 + spread, 25).setScale(0.8).setAlpha(0.16)
        }
      },
    })
    return {
      stop() { timer.remove(false); dice.pose = { ...pose } },
    }
  },

  // Quick drop from a spin onto the resolved face (~260ms). Pairs with spinDice.
  settleDice(color, rawValue, { doubled = false } = {}) {
    const dice = this.cornerDice?.[color]
    if (!dice) return Promise.resolve()
    const spread = doubled ? 44 : 0
    const start = { ...dice.pose }
    const target = dicePose(rawValue)
    const prog = { t: 0 }
    return new Promise((resolve) => {
      this.tweens.add({
        targets: prog, t: 1,
        duration: prefersReducedMotion ? 60 : 260,
        ease: 'Back.easeOut',
        onUpdate: () => {
          const e = prog.t
          const p = {
            x: start.x + (target.x + Math.PI * 2 - start.x) * e,
            y: start.y + (target.y + Math.PI * 2 - start.y) * e,
            tilt: 1 - e,
          }
          const h = (1 - e) * 12
          const paint = (g, baseX) => {
            if (e >= 1) { drawRestingDice(g, rawValue); return }
            drawDice(g, p)
            g.setPosition(baseX, -1 - h).setScale(1 + (1 - e) * 0.3)
          }
          paint(dice.face, -spread)
          if (doubled) paint(dice.face2, spread)
        },
        onComplete: () => {
          dice.pose = target
          dice.value = rawValue
          dice.face.setPosition(-spread, -1).setScale(1)
          dice.shadow.setPosition(2 - spread, 25).setScale(1).setAlpha(0.3)
          drawRestingDice(dice.face, rawValue)
          if (doubled) {
            dice.face2.setVisible(true).setPosition(spread, -1).setScale(1)
            dice.shadow2.setVisible(true).setPosition(2 + spread, 25).setScale(1).setAlpha(0.3)
            drawRestingDice(dice.face2, rawValue)
          }
          sfx.land?.(rawValue)
          sfx.buzz?.(rawValue === 6 ? 28 : 14)
          if (!prefersReducedMotion) {
            this.popAt(dice.container.x, dice.container.y + 20, rawValue === 6 || doubled ? 0xffd54d : COLOR_HEX[color])
          }
          resolve()
        },
      })
    })
  },

  // Tumble `this.cornerDice[color]` to `rawValue`; resolves when it lands.
  animateDiceTumble(color, rawValue, { doubled = false, instant = false } = {}) {
    const dice = this.cornerDice?.[color]
    if (!dice) return Promise.resolve()
    if (instant) { this.restDice(color, rawValue, { doubled }); return Promise.resolve() }

    const tray = dice.container
    const trayY = POD[color].dy
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
