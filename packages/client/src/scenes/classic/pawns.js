// Pawn game objects and everything that moves them: per-step hops, long glides,
// landing impacts, yard/stack reflow and the "tap a glowing pawn" highlights.
import Phaser from 'phaser'
import { samplePawnPath } from '../../ui/pawnMotion.js'
import { DUR, EASE, dur, prefersReducedMotion } from '../../ui/tokens.js'
import { sfx } from '../../audio.js'
import { COLOR_HEX, COLOR_LIGHT } from '@ludo/engine'
import { TILE } from './constants.js'

// Character art is authored feet-on-the-bottom-edge; fit it to a target height.
// Real Ludo pieces sit proudly on their square and overhang it a little - the
// tiles can't grow on a phone, so the pawns carry the size instead.
function fitSprite(sprite, targetH) {
  return Math.min(targetH / sprite.height, (TILE * 1.38) / sprite.width)
}
const YARD_H = 64
const TRACK_H = 56

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
    // a plain soft contact shadow - only shown when the pawn is resting on the
    // track (yards paint their own ground; it's hidden while a pawn moves)
    const shadow = this.add.ellipse(0, 16, 30, 9, 0x0a0f1e, 0.28)
    shadow.name = 'shadow'
    shadow.setVisible(false)
    const glow = this.add.circle(0, -4, 28, COLOR_HEX[color], 0)
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
    sprite.setScale(fitSprite(sprite, YARD_H))
    sprite.name = 'sprite'
    token.add(sprite)
    const zone = this.add.zone(0, -14, 64, 74)
    zone.name = 'zone'
    c.add([shadow, glow, shield, token, zone])
    return c
  },

  layoutPawnView(pawn, view) {
    const onBoard = pawn.steps >= 0
    if (view.getData('onBoard') === onBoard) return
    view.setData('onBoard', onBoard)
    const token = view.getByName('token')
    const sprite = token.getByName('sprite')
    this.tweens.killTweensOf(sprite)
    sprite.setY(onBoard ? 24 : 12).setScale(fitSprite(sprite, onBoard ? TRACK_H : YARD_H))
    view.getByName('shadow')?.setVisible(onBoard).setY(onBoard ? 17 : 8)
    view.getByName('shield').setY(onBoard ? -4 : -16)
    view.getByName('zone').setY(onBoard ? -4 : -14)
  },

  animatePawn(pawn, from, to, onComplete) {
    const view = this.pawnViews.get(pawn)
    this.layoutPawnView(pawn, view)
    const token = view.getByName('token')
    const sprite = token.getByName('sprite')
    ;[view, token, sprite].forEach(target => this.tweens.killTweensOf(target))
    token.setPosition(0, 0).setAngle(0).setScale(1)
    sprite.setScale(fitSprite(sprite, TRACK_H))
    const shadowEl = view.getByName('shadow')
    shadowEl?.setVisible(false)

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

    let motion
    pawn._cancelMotion = () => {
      motion?.stop?.()
      this.tweens.killTweensOf(token)
      token.setPosition(0, 0).setAngle(0).setScale(1)
      shadowEl?.setVisible(pawn.steps >= 0)
      pawn._cancelMotion = null
      onComplete?.()
    }
    const finish = () => {
      pawn._cancelMotion = null
      view.setPosition(dest.x, dest.y).setScale(1).setDepth(restingDepth)
      token.setPosition(0, 0).setAngle(0).setScale(1)
      shadowEl?.setVisible(pawn.steps >= 0)
      onComplete?.()
    }
    if (!count || prefersReducedMotion) {
      motion = this.tweens.add({
        targets: view, x: dest.x, y: dest.y,
        duration: dur(150), ease: EASE.out, onComplete: finish,
      })
      return
    }

    // One clock for the entire path avoids a timer/tween gap at every tile.
    const journey = { progress: 0 }
    let reached = 0
    motion = this.tweens.add({
      targets: journey, progress: 1,
      duration: dur(from === -1 ? 260 : Math.min(1100, 180 + count * 85)),
      ease: 'Linear',
      onUpdate: () => {
        const point = samplePawnPath(points, journey.progress)
        view.setPosition(point.x, point.y)
        token.setY(-Math.sin(point.fraction * Math.PI) * (from === -1 ? 26 : 10))
        if (point.reached > reached) { reached = point.reached; sfx.hop?.(reached) }
      },
      onComplete: () => {
        view.setPosition(dest.x, dest.y)
        this.pawnLand(view, token, dest, pawn.color, finish)
      },
    })
  },

  pawnLand(view, token, at, color, onComplete) {
    this.tweens.killTweensOf(token)
    token.setPosition(0, 0).setAngle(0).setScale(1.06, .95)
    this.tweens.add({
      targets: token, scaleX: 1, scaleY: 1,
      duration: dur(140), ease: EASE.out, onComplete,
    })
    const ring = this.add.ellipse(at.x, at.y + 16, 18, 7, 0xffffff, 0)
      .setStrokeStyle(2, COLOR_LIGHT[color], .6).setDepth(19)
    this.tweens.add({
      targets: ring, scaleX: 2.5, scaleY: 2.5, alpha: 0,
      duration: dur(240), ease: EASE.out, onComplete: () => ring.destroy(),
    })
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
        const offset = offsets[index] ?? { x: 0, y: 0 }
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
      const token = view.getByName('token')
      const glow = view.getByName('glow')
      const active = this.phase === 'move' && !this.isBot(pawn.color) && pawn.color === this.currentColor && this.canMove(pawn)
      view.setAlpha(active ? 1 : 0.92)
      // pulse the token (a child) so it never fights reflowPawns' slide on the view
      this.tweens.killTweensOf(token)
      token.setScale(1)
      if (active) {
        glow?.setFillStyle(COLOR_HEX[pawn.color], 0.28)
        if (!prefersReducedMotion) this.tweens.add({
          targets: token, scale: 1.08,
          duration: 320, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        })
        this.createActivePawnZone(pawn, view)
      } else {
        glow?.setFillStyle(0xffffff, 0)
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
