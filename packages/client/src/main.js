import './style.css'
import Phaser from 'phaser'
import { HomeScene } from './scenes/HomeScene.js'
import { ClassicScene } from './scenes/ClassicScene.js'
import { NetLudoScene } from './scenes/NetLudoScene.js'
import { sfx } from './audio.js'
import { W, H, RENDER_SCALE } from './config.js'
import { session } from './net/playfab.js' // kicks off anonymous device login on load

// Render every Text at RENDER_SCALE resolution so it stays sharp under the
// matching camera zoom (see enterScene). Cheaper and less invasive than passing
// `resolution` at all ~70 call sites.
const _text = Phaser.GameObjects.GameObjectFactory.prototype.text
Phaser.GameObjects.GameObjectFactory.prototype.text = function (x, y, text, style) {
  return _text.call(this, x, y, text, { resolution: RENDER_SCALE, ...style })
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0b1220',
  scale: {
    // canvas height already matches the viewport aspect (see config.js), so FIT
    // fills the screen edge to edge with no letterbox. The backing store is
    // RENDER_SCALE x bigger than the logical size for HiDPI crispness; cameras
    // zoom by the same factor so game coordinates are unchanged.
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: W * RENDER_SCALE,
    height: H * RENDER_SCALE,
  },
  scene: [HomeScene, ClassicScene, NetLudoScene],
})

// Browsers only let an AudioContext start from inside a user gesture.
const unlockAudio = () => sfx.unlock()
window.addEventListener('pointerdown', unlockAudio)
window.addEventListener('keydown', unlockAudio)

if (import.meta.env.DEV) {
  window.__PHASER_GAME__ = game
  window.__PLAYFAB__ = session
}
