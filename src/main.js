import './style.css'
import Phaser from 'phaser'
import { HomeScene } from './scenes/HomeScene.js'
import { ClassicScene } from './scenes/ClassicScene.js'
import { PowerScene } from './scenes/PowerScene.js'

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
  scene: [HomeScene, ClassicScene, PowerScene],
})

if (import.meta.env.DEV) {
  window.__PHASER_GAME__ = game
}
