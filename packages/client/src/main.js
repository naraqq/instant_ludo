import './style.css'
import Phaser from 'phaser'
import { LoadingScene } from './scenes/LoadingScene.js'
import { HomeScene } from './scenes/HomeScene.js'
import { GameSetupScene } from './scenes/GameSetupScene.js'
import { ClassicScene } from './scenes/ClassicScene.js'
import { NetLudoScene } from './scenes/NetLudoScene.js'
import { sfx } from './audio.js'
import { W, H } from './config.js'
import { session } from './net/playfab.js' // kicks off anonymous device login on load

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0b1220',
  scale: {
    // canvas height already matches the viewport aspect (see config.js), so FIT
    // fills the screen edge to edge with no letterbox
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: W,
    height: H,
  },
  scene: [LoadingScene, HomeScene, GameSetupScene, ClassicScene, NetLudoScene],
})

// Browsers only let an AudioContext start from inside a user gesture.
const unlockAudio = () => sfx.unlock()
window.addEventListener('pointerdown', unlockAudio)
window.addEventListener('keydown', unlockAudio)

if (import.meta.env.DEV) {
  window.__PHASER_GAME__ = game
  window.__PLAYFAB__ = session
}
