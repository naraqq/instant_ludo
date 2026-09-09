// Pawn game objects and everything that moves them: per-step hops, long glides,
// landing impacts, yard/stack reflow and the "tap a glowing pawn" highlights.
import Phaser from 'phaser'
import { DUR, EASE, dur, prefersReducedMotion } from '../../ui/tokens.js'
import { sfx } from '../../audio.js'
import { samplePawnPath } from '../../ui/pawnMotion.js'
import { COLOR_HEX, COLOR_LIGHT } from '@ludo/engine'
import { TILE } from './constants.js'

// Character art is authored feet-on-the-bottom-edge; fit it to a target height
// but never let a wide sprite (earth's rocks, air's wisps) overrun its tile.
function fitSprite(sprite, targetH) {
  return Math.min(targetH / sprite.height, (TILE * 1.12) / sprite.width)
}

export const PawnsMixin = {
  createPawns() {
    this.activeColors.forEach((color) => {
      for (let i = 0; i < 4; i++) {
        const pawn = { color, id: i, steps: -1, finished: false }
        this.pawns.push(pawn)
        const view = this.makePawnView(color)
        this.pawnViews.set(pawn, view)
        this.positionPawn(pawn, false)
      }
    })
  },

  makePawnView(color) {
    const c = this.add.container(0, 0).setDepth(20)
    c.setData('onBoard', false)
    // soft contact shadow, drawn behind everything; sized in layoutPawnView
    const restShadow = this.add.ellipse(0, 2, 30, 9, 0x0a0d20, 0.28)
    restShadow.name = 'restShadow'
    restShadow.setVisible(false)
    const glow = this.add.circle(0, -4, 25, COLOR_HEX[color], 0)
    glow.name = 'glow'

    // protective bubble (hidden until the earth power is used)
    const shield = this.add.container(0, -16)
    shield.name = 'shield'
    shield.add(this.add.circle(0, 0, 32, 0x5ad6ff, 0.12))
    shield.add(this.add.circle(0, 0, 26, 0xcdf4ff, 0.16).setStrokeStyle(3, 0x7ee6ff, 0.95))
    shield.add(this.add.circle(-9, -12, 5, 0xffffff, 0.7))
    shield.setVisible(false)

    const token = this.add.container(0, 0)
    token.name = 'token'
    // Yard layout; track pawns use a lower, tighter layout in layoutPawnView.
    const sprite = this.add.image(0, 12, `pawn-${color}`).setOrigin(0.5, 1)
    sprite.setScale(fitSprite(sprite, 64))
    sprite.name = 'sprite'
    token.add(sprite)
    const zone = this.add.zone(0, -14, 58, 68)
    zone.name = 'zone'
    c.add([restShadow, glow, shield, token, zone])
    return c
  },

  layoutPawnView(pawn, view) {
    const onBoard = pawn.steps >= 0
    if (view.getData('onBoard') === onBoard) return
    view.setData('onBoard', onBoard)
    const token = view.getByName('token')
    const sprite = token.getByName('sprite')
    this.tweens.killTweensOf(sprite)
    sprite.setY(onBoard ? 24 : 12).setScale(fitSprite(sprite, onBoard ? 56 : 64))
    view.getByName('shield').setY(onBoard ? -4 : -16)
    view.getByName('zone').setY(onBoard ? -4 : -14)
    // contact shadow only when out on the track (yards paint their own ground)
    const restShadow = view.getByName('restShadow')
    restShadow.setVisible(onBoard).setPosition(0, onBoard ? 18 : 2)
  },

  animatePawn(pawn, from, to, onComplete) {
    const view = this.pawnViews.get(pawn)
    this.layoutPawnView(pawn, view)
    const token = view.getByName('token')
    const sprite = token.getByName('sprite')
    ;[view, token, sprite].forEach(target => this.tweens.killTweensOf(target))
    token.setPosition(0, 0).setAngle(0).setScale(1)
    sprite.setScale(fitSprite(sprite, 56))
    // the moving hop/glide draws its own shadow; hide the resting one until landing
    const restShadow = view.getByName('restShadow')
    restShadow.setVisible(false)

    const points = [{ x: view.x, y: view.y }]
    if (from === -1) points.push(this.getPixelFor(pawn.color, 0))
    else for (let step = from + 1; step <= to; step++) points.push(this.getPixelFor(pawn.color, step))
    // a finishing pawn glides to its own parking spot in the centre triangle,
    // not the shared dead-centre point getPixelFor returns for step 56
    if (pawn.finished && points.length > 1) points[points.length - 1] = this.getFinishSlot(pawn)
    const count = points.length - 1
    const dest = points[count]
    const restingDepth = 20
    view.setDepth(40).setAlpha(1).setScale(1)

    const finish = () => {
      view.setPosition(dest.x, dest.y).setScale(1).setDepth(restingDepth)
      token.setPosition(0, 0).setAngle(0).setScale(1)
      restShadow.setVisible(pawn.steps >= 0)
      onComplete?.()
    }
    if (!count || prefersReducedMotion) {
      this.tweens.add({
        targets: view, x: dest.x, y: dest.y,
        duration: dur(150), ease: EASE.out, onComplete: finish,
      })
      return
    }

    // Punchy per-tile hops sell a pawn breaking out of its yard or nudging a
    // single square; longer journeys read better as one continuous glide.
    const leaving = from === -1
    if (leaving || count === 1) {
      this.hopPawn(view, token, points, count, leaving, dest, pawn.color, finish)
    } else {
      this.glidePawn(view, token, points, count, dest, pawn.color, finish)
    }
  },

  // One smooth, eased journey through every tile - no per-square braking.
  glidePawn(view, token, points, count, dest, color, finish) {
    const startScale = view.getData('stackScale') ?? 1
    const shadow = this.add.ellipse(view.x, view.y + 19, 30, 9, 0x10142b, .2).setDepth(19)
    const marker = this.add.ellipse(dest.x, dest.y + 17, 32, 12, 0xffffff, 0)
      .setStrokeStyle(2, COLOR_LIGHT[color], .65).setDepth(19)
    const motion = { progress: 0 }
    let reached = 0
    this.tweens.add({
      targets: motion, progress: 1,
      duration: dur(Math.min(900, 200 + count * 65)),
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const sample = samplePawnPath(points, motion.progress)
        const lift = Math.sin(motion.progress * Math.PI)
        view.setPosition(sample.x, sample.y)
          .setScale(startScale + (1 - startScale) * Math.min(1, motion.progress * 5))
        token.setY(-lift * (4 + Math.sin(sample.fraction * Math.PI) * 2))
          .setAngle(sample.dx * 7 * lift)
          .setScale(1 - Math.abs(sample.dy) * .025 * lift, 1 + .035 * lift)
        shadow.setPosition(sample.x, sample.y + 19).setScale(1 - lift * .15).setAlpha(.2 - lift * .07)
        while (reached < sample.reached) {
          reached++
          sfx.hop(reached - 1)
          if (reached < count) {
            const point = points[reached]
            const trail = this.add.ellipse(point.x, point.y + 17, 19, 7, COLOR_HEX[color], .28).setDepth(18)
            this.tweens.add({
              targets: trail, alpha: 0, scale: .45, duration: dur(260),
              onComplete: () => trail.destroy(),
            })
          }
        }
      },
      onComplete: () => {
        view.setPosition(dest.x, dest.y).setScale(1)
        shadow.destroy()
        this.tweens.add({
          targets: marker, scale: 1.6, alpha: 0, duration: dur(220),
          ease: EASE.out, onComplete: () => marker.destroy(),
        })
        token.setY(0).setAngle(0).setScale(1.06, .92)
        this.tweens.add({
          targets: token, scaleX: 1, scaleY: 1,
          duration: dur(110), ease: 'Sine.easeOut', onComplete: finish,
        })
      },
    })
  },

  hopPawn(view, token, points, count, leaving, dest, color, finish) {
    // the pawn "picks up" out of its stack
    this.tweens.add({ targets: view, scale: 1, duration: dur(90), ease: EASE.pop })

    // long paths hop a bit faster and lower so a six doesn't drag
    const hopDur = dur(leaving ? 300 : Phaser.Math.Clamp(190 - count * 8, 116, 190))
    const arc = leaving ? 50 : Phaser.Math.Clamp(36 - count * 1.6, 20, 36)
    const shadow = this.add.ellipse(view.x, view.y + 18, 30, 9, 0x0a0d20, 0.3).setDepth(19)

    const hop = (i) => {
      if (i >= count) {
        shadow.destroy()
        this.pawnLand(view, token, dest, color, true)
        this.time.delayedCall(dur(90), finish)
        return
      }
      const a = points[i]
      const b = points[i + 1]
      const lean = Math.sign(b.x - a.x) * 11 + Math.sign(b.y - a.y) * 4
      const st = { t: 0 }
      // quick anticipation crouch, then the arc
      this.tweens.add({
        targets: token, scaleX: 1.18, scaleY: 0.8,
        duration: dur(leaving ? 60 : 46), ease: 'Quad.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: st, t: 1, duration: hopDur, ease: 'Sine.easeInOut',
            onUpdate: () => {
              const t = st.t
              const lift = Math.sin(t * Math.PI)
              view.setPosition(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
              token.setY(-arc * lift * lift ** 0.15) // slightly front-loaded arc
                .setAngle(lean * lift * (1 - t * 0.35))
                .setScale(1 - 0.16 * lift + 0.06 * t, 1 + 0.24 * lift - 0.06 * t)
              shadow.setPosition(view.x, view.y + 18)
                .setScale(1 - lift * 0.45, 1 - lift * 0.6)
                .setAlpha(0.3 - lift * 0.2)
            },
            onComplete: () => {
              sfx.hop?.(i)
              this.pawnLand(view, token, b, color, false)
              this.time.delayedCall(dur(leaving ? 45 : 22), () => hop(i + 1))
            },
          })
        },
      })
    }
    hop(0)
  },

  // impact on landing a tile: squash + ground ring + a puff of dust
  pawnLand(view, token, at, color, final) {
    this.tweens.killTweensOf(token)
    token.setPosition(0, 0).setAngle(0).setScale(final ? 1.32 : 1.22, final ? 0.68 : 0.8)
    this.tweens.add({
      targets: token, scaleX: 1, scaleY: 1,
      duration: dur(final ? 260 : 130),
      ease: final ? EASE.pop : 'Back.easeOut',
    })
    const ring = this.add.ellipse(at.x, at.y + 16, 18, 7, 0xffffff, 0)
      .setStrokeStyle(2.5, COLOR_LIGHT[color], 0.75).setDepth(19)
    this.tweens.add({
      targets: ring, scaleX: final ? 3.2 : 2, scaleY: final ? 3.2 : 2, alpha: 0,
      duration: dur(final ? 340 : 210), ease: EASE.out,
      onComplete: () => ring.destroy(),
    })
    const puffs = final ? 6 : 2
    for (let k = 0; k < puffs; k++) {
      const puff = this.add.circle(
        at.x + Phaser.Math.Between(-5, 5), at.y + 15,
        Phaser.Math.Between(2, 4), 0xdfe4f2, 0.55
      ).setDepth(18)
      this.tweens.add({
        targets: puff,
        x: puff.x + Phaser.Math.Between(-18, 18),
        y: puff.y - Phaser.Math.Between(1, 9),
        alpha: 0, scale: 0.2,
        duration: dur(Phaser.Math.Between(200, 300)), ease: EASE.out,
        onComplete: () => puff.destroy(),
      })
    }
    if (final) this.cameras.main.shake(dur(100), 0.0016)
  },

  positionPawn(pawn, animate) {
    const view = this.pawnViews.get(pawn)
    this.layoutPawnView(pawn, view)
    const target = this.getPawnPixel(pawn)
    if (animate) {
      this.tweens.add({ targets: view, x: target.x, y: target.y, duration: 250, ease: 'Back.easeOut' })
    } else {
      view.setPosition(target.x, target.y)
    }
  },

  // Stamp a pawn's empty starting slot in the yard once it reaches the finish,
  // so the yard reads as a scoreboard of how many are home.
  markPawnHome(pawn) {
    this.homeMarks ||= []
    const [gx, gy] = this.yardSlots(pawn.color)[pawn.id]
    const { x, y } = this.gridToPixel(gx, gy)
    const mark = this.add.container(x, y).setDepth(16)
    mark.add(this.add.circle(1, 2, 14, 0x000000, 0.25))
    mark.add(this.add.circle(0, 0, 14, COLOR_HEX[pawn.color]).setStrokeStyle(2.5, 0xffffff))
    mark.add(this.add.text(0, 1, '✓', {
      fontFamily: 'Verdana, sans-serif', fontSize: 16, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5))
    this.homeMarks.push(mark)
    if (prefersReducedMotion) return
    mark.setScale(0)
    this.tweens.add({ targets: mark, scale: 1, duration: dur(DUR.base), ease: EASE.pop, delay: dur(120) })
  },

  // A pawn that just reached home takes a short victory bow, then leaves the
  // board - the check mark stamped into its yard slot is the lasting record.
  // (Four shrunken characters crowded around the centre star never read well.)
  parkFinishedPawn(pawn) {
    const view = this.pawnViews.get(pawn)
    if (!view) return
    this.tweens.killTweensOf(view)
    const token = view.getByName('token')
    this.tweens.killTweensOf(token)
    token.setPosition(0, 0).setAngle(0).setScale(1)
    view.getByName('restShadow')?.setVisible(false)
    view.getByName('glow')?.setFillStyle(0xffffff, 0)
    this.markPawnHome(pawn)
    sfx.rune?.()
    const base = view.getData('stackScale') ?? 1
    if (prefersReducedMotion || this._behind) {
      view.setVisible(false).setAlpha(0).setScale(base)
      return
    }
    this.popAt(view.x, view.y, COLOR_HEX[pawn.color])
    this.tweens.add({
      targets: view, scale: base * 1.4,
      duration: dur(220), ease: EASE.pop,
      onComplete: () => this.tweens.add({
        targets: view, alpha: 0, scale: base * 0.72, y: view.y - 12,
        duration: dur(300), ease: EASE.out,
        onComplete: () => view.setVisible(false).setScale(base).setPosition(-9999, -9999),
      }),
    })
  },

  reflowPawns(animate) {
    const groups = new Map()
    this.pawns.forEach((pawn) => {
      if (pawn.finished) {
        // retired by parkFinishedPawn; a bare state-snap rebuild lands here too
        const v = this.pawnViews.get(pawn)
        if (v && v.visible && !this.tweens.isTweening(v)) v.setVisible(false).setAlpha(0)
        return
      }
      const key = this.getPawnStackKey(pawn)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(pawn)
    })

    groups.forEach((stack) => {
      const offsets = this.getStackOffsets(stack.length)
      const scale = this.getStackScale(stack.length)
      stack.forEach((pawn, index) => {
        const view = this.pawnViews.get(pawn)
        this.layoutPawnView(pawn, view)
        const base = this.getPawnPixel(pawn)
        const offset = offsets[index]
        view.setData('stackScale', scale)
        view.setData('stackOffset', offset)
        this.tweens.killTweensOf(view)
        if (animate) {
          this.tweens.add({
            targets: view,
            x: base.x + offset.x,
            y: base.y + offset.y,
            scale,
            duration: 180,
            ease: 'Sine.easeOut',
          })
        } else {
          view.setPosition(base.x + offset.x, base.y + offset.y)
          view.setScale(scale)
        }
      })
    })
  },

  updatePawnHighlights() {
    this.clearActivePawnZones()
    this.pawns.forEach((pawn) => {
      if (pawn.finished) return // retired from the board - see parkFinishedPawn
      const view = this.pawnViews.get(pawn)
      if (!view) return
      const glow = view.getByName('glow')
      const active = this.phase === 'move' && !this.isBot(pawn.color) && pawn.color === this.currentColor && this.canMove(pawn)
      view.setAlpha(active ? 1 : 0.92)
      this.tweens.killTweensOf(view)
      if (active) {
        glow?.setFillStyle(COLOR_HEX[pawn.color], 0.28)
        const stackScale = view.getData('stackScale') ?? 1
        this.tweens.add({
          targets: view,
          scale: stackScale * 1.14,
          duration: 320,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        })
        this.createActivePawnZone(pawn, view)
      } else {
        glow?.setFillStyle(0xffffff, 0)
        view.setScale(view.getData('stackScale') ?? 1)
      }
    })
  },

  createActivePawnZone(pawn, view) {
    const stackScale = view.getData('stackScale') ?? 1
    const centerY = pawn.steps >= 0 ? -4 : -20
    const zone = this.add.zone(view.x, view.y + centerY * stackScale, Math.max(42, 62 * stackScale), Math.max(48, 70 * stackScale))
      .setDepth(90)
      .setInteractive({ useHandCursor: true })
    zone.on('pointerover', () => {
      if (this.phase !== 'move') return
      view.setDepth(40)
    })
    zone.on('pointerout', () => {
      view.setDepth(20)
    })
    zone.on('pointerup', () => this.tryMovePawn(pawn))
    this.activePawnZones.push(zone)
  },

  clearActivePawnZones() {
    this.activePawnZones.forEach((zone) => zone.destroy())
    this.activePawnZones = []
  },
}
