import Phaser from 'phaser'

const BALL_COLORS = [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xc770f0, 0xff922b]

export class PlaygroundScene extends Phaser.Scene {
  constructor() {
    super('Playground')
    this.ballCount = 0
  }

  preload() {
    // Draw circle textures once so balls don't need image assets.
    const g = this.make.graphics()
    BALL_COLORS.forEach((color, i) => {
      g.clear()
      g.fillStyle(color, 1)
      g.fillCircle(24, 24, 24)
      g.generateTexture(`ball-${i}`, 48, 48)
    })
    g.fillStyle(0xffffff, 1)
    g.fillCircle(8, 8, 8)
    g.generateTexture('spark', 16, 16)
    g.destroy()
  }

  create() {
    const { width, height } = this.scale

    this.floor = this.add.rectangle(width / 2, height - 4, width, 8, 0x2a2f3a)
    this.physics.add.existing(this.floor, true)

    this.leftWall = this.add.rectangle(0, height / 2, 8, height, 0x2a2f3a)
    this.physics.add.existing(this.leftWall, true)

    this.rightWall = this.add.rectangle(width, height / 2, 8, height, 0x2a2f3a)
    this.physics.add.existing(this.rightWall, true)

    this.balls = this.physics.add.group()
    this.physics.add.collider(this.balls, this.balls)
    this.physics.add.collider(this.balls, this.floor)
    this.physics.add.collider(this.balls, this.leftWall)
    this.physics.add.collider(this.balls, this.rightWall)

    this.hint = this.add
      .text(width / 2, 48, 'Click / tap anywhere to spawn balls', {
        fontFamily: 'sans-serif',
        fontSize: 20,
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setAlpha(0.85)
    this.tweens.add({
      targets: this.hint,
      alpha: 0.35,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    })

    this.countText = this.add.text(16, 16, 'Balls: 0', {
      fontFamily: 'sans-serif',
      fontSize: 18,
      color: '#9aa5b1',
    })

    this.emitter = this.add.particles(0, 0, 'spark', {
      speed: { min: 80, max: 200 },
      scale: { start: 1, end: 0 },
      lifespan: 400,
      quantity: 0,
      emitting: false,
      blendMode: 'ADD',
      tint: BALL_COLORS,
    })

    this.clearBtn = this.add
      .text(width - 16, 16, 'Clear', {
        fontFamily: 'sans-serif',
        fontSize: 18,
        color: '#ffffff',
        backgroundColor: '#3a4150',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })

    this.clearBtn.on('pointerover', () => this.clearBtn.setStyle({ backgroundColor: '#4d5566' }))
    this.clearBtn.on('pointerout', () => this.clearBtn.setStyle({ backgroundColor: '#3a4150' }))
    this.clearBtn.on('pointerdown', () => {
      this.clearBalls()
    })

    this.input.on('pointerdown', (pointer, currentlyOver) => {
      if (currentlyOver.includes(this.clearBtn)) return
      this.spawnBall(pointer.x, pointer.y)
    })
  }

  spawnBall(x, y) {
    const colorIndex = Phaser.Math.Between(0, BALL_COLORS.length - 1)
    const scale = Phaser.Math.FloatBetween(0.5, 1.2)
    const ball = this.balls.create(x, y, `ball-${colorIndex}`)
    ball.setScale(0)
    ball.setCircle(24)
    ball.setBounce(0.7)
    ball.setVelocity(Phaser.Math.Between(-150, 150), Phaser.Math.Between(-100, 0))

    this.tweens.add({ targets: ball, scale, duration: 220, ease: 'Back.easeOut' })

    this.emitter.explode(10, x, y)

    this.ballCount++
    this.countText.setText(`Balls: ${this.ballCount}`)
  }

  clearBalls() {
    this.cameras.main.shake(150, 0.005)
    const children = this.balls.getChildren().slice()
    children.forEach((ball, i) => {
      this.tweens.add({
        targets: ball,
        scale: 0,
        alpha: 0,
        delay: i * 8,
        duration: 200,
        ease: 'Back.easeIn',
        onComplete: () => ball.destroy(),
      })
    })
    this.ballCount = 0
    this.countText.setText('Balls: 0')
  }
}
