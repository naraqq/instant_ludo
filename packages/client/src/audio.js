// Lightweight SFX manager. Most cues are synthesized; the dice roll uses the
// supplied recording. Everything respects the persisted sound/haptics setting.

import { store } from './store.js'

class AudioManager {
  constructor() {
    this.ctx = null
    this.rollAudio = null
  }

  // Must be called from inside a user gesture (pointerdown) at least once so
  // the browser lets the context start.
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext
      if (!Ctor) return
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    if (!this.rollAudio && window.Audio) {
      this.rollAudio = new window.Audio('/dice_rolling.mp3')
      this.rollAudio.preload = 'auto'
      this.rollAudio.volume = 0.48
      this.rollAudio.playbackRate = 2
    }
  }

  get on() {
    return store.sound && !!this.ctx
  }

  tone(freq, { dur = 0.12, type = 'sine', gain = 0.16, slideTo = null, delay = 0 } = {}) {
    if (!this.on) return
    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const amp = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
    amp.gain.setValueAtTime(0.0001, t0)
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(amp).connect(this.ctx.destination)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  noise({ dur = 0.2, gain = 0.2 } = {}) {
    if (!this.on) return
    const t0 = this.ctx.currentTime
    const frames = Math.floor(this.ctx.sampleRate * dur)
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate)
    const chan = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) chan[i] = (Math.random() * 2 - 1) * (1 - i / frames)
    const src = this.ctx.createBufferSource()
    const amp = this.ctx.createGain()
    src.buffer = buffer
    amp.gain.setValueAtTime(gain, t0)
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(amp).connect(this.ctx.destination)
    src.start(t0)
  }

  tap() { this.tone(520, { dur: 0.07, type: 'triangle', gain: 0.1 }) }
  roll() {
    if (!this.on) return
    const audio = this.rollAudio
    if (!audio) { this.tone(180, { dur: 0.28, type: 'square', gain: 0.08, slideTo: 90 }); return }
    audio.pause()
    audio.currentTime = 0
    audio.play().catch(() => this.tone(180, { dur: 0.28, type: 'square', gain: 0.08, slideTo: 90 }))
  }
  stopRoll() {
    if (!this.rollAudio) return
    this.rollAudio.pause()
    this.rollAudio.currentTime = 0
  }
  land(value) {
    this.stopRoll()
    this.tone(340 + value * 30, { dur: 0.14, type: 'triangle', gain: 0.14 })
    this.tone(180, { dur: 0.1, type: 'sine', gain: 0.1, delay: 0.02 })
  }
  hop(step = 0) {
    // pitch climbs a little with each successive hop of a move
    this.tone(540 + Math.min(step, 6) * 32, { dur: 0.055, type: 'sine', gain: 0.07 })
  }
  extraRoll() {
    ;[660, 880, 1100].forEach((frequency, i) =>
      this.tone(frequency, { dur: 0.12, type: 'triangle', gain: 0.08, delay: i * 0.07 })
    )
  }
  rune() {
    this.tone(880, { dur: 0.1, type: 'triangle', gain: 0.12 })
    this.tone(1320, { dur: 0.12, type: 'triangle', gain: 0.1, delay: 0.06 })
  }
  gateReward(key) {
    const root = { fire: 523, water: 659, earth: 440 }[key] || 523
    this.tone(root, { dur: 0.14, type: 'triangle', gain: 0.055 })
    this.tone(root * 1.25, { dur: 0.22, type: 'sine', gain: 0.045, delay: 0.07 })
  }
  power() { this.tone(220, { dur: 0.3, type: 'sawtooth', gain: 0.12, slideTo: 780 }) }
  capture() {
    this.noise({ dur: 0.22, gain: 0.22 })
    this.tone(140, { dur: 0.22, type: 'square', gain: 0.14, slideTo: 60 })
  }
  shield() { this.tone(300, { dur: 0.35, type: 'sine', gain: 0.1, slideTo: 620 }) }
  win() {
    ;[523, 659, 784, 1046].forEach((f, i) =>
      this.tone(f, { dur: 0.3, type: 'triangle', gain: 0.16, delay: i * 0.12 })
    )
  }
  lose() {
    ;[440, 349, 262].forEach((f, i) =>
      this.tone(f, { dur: 0.3, type: 'sine', gain: 0.14, delay: i * 0.14 })
    )
  }

  buzz(ms) {
    if (store.haptics && navigator.vibrate) navigator.vibrate(ms)
  }
}

export const sfx = new AudioManager()
