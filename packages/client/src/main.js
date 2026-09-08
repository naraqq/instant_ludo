import './style.css'
import Phaser from 'phaser'
import { HomeScene } from './scenes/HomeScene.js'
import { ClassicScene } from './scenes/ClassicScene.js'
import { sfx } from './audio.js'
import { session } from './net/playfab.js' // kicks off anonymous device login on load

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#141821',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: 720,
    height: 1280,
  },
  scene: [HomeScene, ClassicScene],
})

// Browsers only let an AudioContext start from inside a user gesture.
const unlockAudio = () => sfx.unlock()
window.addEventListener('pointerdown', unlockAudio)
window.addEventListener('keydown', unlockAudio)

if (import.meta.env.DEV) {
  window.__PHASER_GAME__ = game
  window.__PLAYFAB__ = session
}
