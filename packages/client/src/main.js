import './style.css'
import Phaser from 'phaser'
import { HomeScene } from './scenes/HomeScene.js'
import { ClassicScene } from './scenes/ClassicScene.js'
import { NetLudoScene } from './scenes/NetLudoScene.js'
import { sfx } from './audio.js'
import { W, H } from './config.js'
import { session } from './net/playfab.js' // kicks off anonymous device login on load

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#141821',
  scale: {
    mode: Phaser.Scale.FIT,
    // top-align: a tall phone should letterbox BELOW the action bar, never push
    // the board down behind the browser's top chrome
    autoCenter: Phaser.Scale.CENTER_HORIZONTALLY,
    width: W,
    height: H,
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
