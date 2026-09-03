import Phaser from 'phaser'
import { W, H, MARGIN, CONTENT_W } from '../config.js'
import { UIScene } from '../ui/UIScene.js'

export class HomeScene extends UIScene {
  constructor() {
    super('Home')
    this.coins = 12750
    this.gems = 390
  }

  preload() {
    this.makeBackgroundTexture('bg-home', '#241a4a', '#8a4fc4')
    this.makePawnTextures()
  }

  create() {
    this.add.image(W / 2, H / 2, 'bg-home')
    this.createSkyline()

    this.createTopBar()
    this.createPromoRow()
    this.createModeCards()
    this.createSmallCards()
    this.createChatBar()
    this.createBanners()
    this.createBottomNav()

    this.cameras.main.fadeIn(200, 0, 0, 0)
  }

  // ---------- background ----------

  createSkyline() {
    const g = this.add.graphics()
    g.fillStyle(0x1a1030, 0.35)
    let x = 0
    while (x < W) {
      const bw = Phaser.Math.Between(40, 90)
      const bh = Phaser.Math.Between(80, 220)
      g.fillRect(x, H - bh, bw, bh)
      x += bw + Phaser.Math.Between(4, 14)
    }
    g.fillStyle(0xffffff, 0.06)
    g.fillCircle(W - 90, H - 260, 70)
    g.lineStyle(2, 0xffffff, 0.08)
    for (let a = 0; a < 360; a += 45) {
      const rad = Phaser.Math.DegToRad(a)
      g.lineBetween(W - 90, H - 260, W - 90 + Math.cos(rad) * 70, H - 260 + Math.sin(rad) * 70)
    }
  }

  makePawnTextures() {
    const colors = { red: 0xff5252, green: 0x4ecb71, blue: 0x4d96ff, yellow: 0xffd54d }
    const g = this.make.graphics()
    Object.entries(colors).forEach(([name, color]) => {
      g.clear()
      g.fillStyle(color, 1)
      g.fillCircle(18, 18, 18)
      g.fillStyle(0xffffff, 0.35)
      g.fillCircle(13, 12, 6)
      g.generateTexture(`pawn-${name}`, 36, 36)
    })
    g.destroy()
  }

  // ---------- top bar ----------

  createTopBar() {
    const cy = 76
    this.makeRoundedRectTexture('bar-topbar', CONTENT_W, 104, 0x18234a, 0x223257, 52)
    this.add.image(W / 2, cy, 'bar-topbar').setAlpha(0.92)

    const avatar = this.add.circle(80, cy, 46, 0x2b1f5c)
    avatar.setStrokeStyle(3, 0xffd54d)
    this.add.text(80, cy, '🦊', { fontSize: 44 }).setOrigin(0.5)

    this.makeRoundedRectTexture('level-badge', 66, 26, 0x7a1f3d, 0x7a1f3d, 13, 0xffd54d)
    this.add.image(80, cy + 46, 'level-badge')
    this.add.text(80, cy + 46, 'Lv.39', {
      fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5)

    const coinPill = this.createTopPill(245, cy, 210, '🪙', () => this.formatCoins(this.coins), '#ffe27a')
    this.coinLabel = coinPill.amountText

    const plusZone = this.makeHitZone(340, cy, 38, 38)
    const plusBtn = this.add.circle(340, cy, 19, 0x34c759)
    this.add.text(340, cy, '+', { fontFamily: 'Verdana, sans-serif', fontSize: 22, color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5)
    this.addPressFeedback(plusZone, plusBtn, () => this.showToast('Buy more coins — Shop coming soon!'))

    this.createTopPill(440, cy, 150, '💎', () => `${this.gems}`, '#c9a6ff')

    const mailZone = this.makeHitZone(560, cy, 52, 52)
    const mail = this.add.circle(560, cy, 26, 0x223257).setStrokeStyle(2, 0x3a4a78)
    this.add.text(560, cy, '✉️', { fontSize: 22 }).setOrigin(0.5)
    this.addPressFeedback(mailZone, mail, () => this.showToast('No new messages'))

    const settingsZone = this.makeHitZone(636, cy, 52, 52)
    const settings = this.add.circle(636, cy, 26, 0x223257).setStrokeStyle(2, 0x3a4a78)
    this.add.text(636, cy, '⚙️', { fontSize: 22 }).setOrigin(0.5)
    this.addPressFeedback(settingsZone, settings, () => this.showToast('Settings — coming soon'))
  }

  createTopPill(cx, cy, w, icon, amountFn, color) {
    const key = `pill-${w}`
    this.makeRoundedRectTexture(key, w, 64, 0x223257, 0x223257, 32)
    this.add.image(cx, cy, key)
    this.add.text(cx - w / 2 + 24, cy, icon, { fontSize: 26 }).setOrigin(0.5)
    const amountText = this.add.text(cx - w / 2 + 48, cy, amountFn(), {
      fontFamily: 'Verdana, sans-serif', fontSize: 21, color, fontStyle: 'bold',
    }).setOrigin(0, 0.5)
    return { amountText }
  }

  formatCoins(n) {
    return n.toLocaleString('en-US')
  }

  bumpCoins(amount) {
    this.coins += amount
    this.coinLabel.setText(this.formatCoins(this.coins))
    this.tweens.add({
      targets: this.coinLabel,
      scale: { from: 1.4, to: 1 },
      duration: 300,
      ease: 'Back.easeOut',
    })
  }

  // ---------- promo icon row ----------

  createPromoRow() {
    const items = [
      { icon: '💰', label: 'Endless Riches', timer: '1d 23h', badge: '1' },
      { icon: '💎', label: 'Gems Pack' },
      { icon: '🎡', label: 'Lucky Wheel', badge: '8' },
      { icon: '📝', label: 'Feedback' },
    ]
    const cardW = (CONTENT_W - 12 * 3) / 4
    const cy = 146 + 150 / 2

    items.forEach((item, i) => {
      const cx = MARGIN + cardW / 2 + i * (cardW + 12)
      this.createPromoCard(cx, cy, cardW, item)
    })
  }

  createPromoCard(cx, cy, slotW, { icon, label, timer, badge }) {
    const iconSize = 92
    const key = `promo-icon-${iconSize}`
    this.makeRoundedRectTexture(key, iconSize, iconSize, 0xfff3d6, 0xffe6b0, 18)

    const container = this.add.container(cx, cy - 8)
    const bg = this.add.image(0, -22, key)
    const iconText = this.add.text(0, -22, icon, { fontSize: 44 }).setOrigin(0.5)
    const labelText = this.add.text(0, 55, label, {
      fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#ffffff', fontStyle: 'bold',
      align: 'center', wordWrap: { width: slotW + 10 },
    }).setOrigin(0.5).setShadow(0, 1, '#000000aa', 2, false, true)

    container.add([bg, iconText, labelText])

    if (timer) {
      const timerKey = 'timer-pill'
      this.makeRoundedRectTexture(timerKey, 66, 22, 0xff4757, 0xff4757, 11)
      const timerBg = this.add.image(0, -22 - iconSize / 2 - 2, timerKey)
      const timerText = this.add.text(0, -22 - iconSize / 2 - 2, timer, {
        fontFamily: 'Verdana, sans-serif', fontSize: 11, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5)
      container.add([timerBg, timerText])
    }

    if (badge) {
      const bx = iconSize / 2 - 6
      const by = -22 - iconSize / 2 + 6
      const badgeBg = this.add.circle(bx, by, 13, 0xff3b30).setStrokeStyle(2, 0xffffff)
      const badgeText = this.add.text(bx, by, badge, {
        fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5)
      container.add([badgeBg, badgeText])
    }

    const zone = this.makeHitZone(cx, cy - 8, slotW, 150)
    this.addPressFeedback(zone, container, () => this.showToast(`Opening ${label}...`))
    return container
  }

  // ---------- mode cards ----------

  createModeCards() {
    const cardW = (CONTENT_W - 16) / 2
    const cardH = 325
    const cy = 316 + cardH / 2

    this.createModeCard(MARGIN + cardW / 2, cy, cardW, cardH, {
      key: 'power',
      gradientTop: 0xffd85e,
      gradientBottom: 0xff9a2e,
      stroke: 0xffedb0,
      title: 'POWER',
      subtitle: 'Fast dice battles',
      ribbon: { text: 'HOT', color: 0xff3b30 },
      buildIcon: (c) => {
        c.add(this.add.text(0, -40, '🎲', { fontSize: 88 }).setOrigin(0.5))
        c.add(this.add.text(-95, -110, '⭐', { fontSize: 30 }).setOrigin(0.5))
      },
      onClick: () => this.goTo('Power'),
    })

    this.createModeCard(MARGIN + cardW + 16 + cardW / 2, cy, cardW, cardH, {
      key: 'classic',
      gradientTop: 0xff9a5c,
      gradientBottom: 0xff6a3d,
      stroke: 0xffd9c2,
      title: 'CLASSIC',
      subtitle: '2-4 player Ludo',
      buildIcon: (c) => {
        const offsets = [
          ['pawn-red', -28, -50],
          ['pawn-green', 28, -50],
          ['pawn-blue', -28, -14],
          ['pawn-yellow', 28, -14],
        ]
        offsets.forEach(([tex, ox, oy]) => c.add(this.add.image(ox, oy, tex).setScale(1.4)))
      },
      onClick: () => this.goTo('Classic'),
    })
  }

  createModeCard(cx, cy, w, h, { key, gradientTop, gradientBottom, stroke, title, subtitle, ribbon, buildIcon, onClick }) {
    this.makeRoundedRectTexture(`mode-${key}`, w, h, gradientTop, gradientBottom, 24, stroke)

    const container = this.add.container(cx, cy)
    container.add(this.add.image(0, 0, `mode-${key}`))

    buildIcon(container)

    const title1 = this.add.text(0, 108, title, {
      fontFamily: 'Verdana, sans-serif', fontSize: 42, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5).setStroke('#00000040', 5)
    container.add(title1)

    const subtitleText = this.add.text(0, 146, subtitle, {
      fontFamily: 'Verdana, sans-serif', fontSize: 14, color: '#ffffffcc',
    }).setOrigin(0.5)
    container.add(subtitleText)

    if (ribbon) {
      const ribbonKey = `ribbon-${ribbon.text}`
      this.makeRoundedRectTexture(ribbonKey, 74, 30, ribbon.color, ribbon.color, 8)
      const ribbonBg = this.add.image(-w / 2 + 44, -h / 2 + 28, ribbonKey).setAngle(-10)
      const ribbonText = this.add.text(-w / 2 + 44, -h / 2 + 28, ribbon.text, {
        fontFamily: 'Verdana, sans-serif', fontSize: 15, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setAngle(-10)
      container.add([ribbonBg, ribbonText])
    }

    const zone = this.makeHitZone(cx, cy, w, h)
    this.addPressFeedback(zone, container, onClick)
    return container
  }

  // ---------- small cards ----------

  createSmallCards() {
    const cardW = (CONTENT_W - 12 * 2) / 3
    const cardH = 196
    const cy = 655 + cardH / 2

    const configs = [
      { key: 'minimap', gradientTop: 0x35e0c8, gradientBottom: 0x12a898, icon: '🗺️', label: 'Mini Map', ribbon: { text: 'NEW', color: 0x34c759 } },
      { key: 'friends', gradientTop: 0x5fa8ff, gradientBottom: 0x3a74e0, icon: '👫', label: 'Friends' },
      { key: 'computer', gradientTop: 0xb48bff, gradientBottom: 0x8a5cf0, icon: '🤖', label: 'Computer & Local', onClick: () => this.goTo('Classic') },
    ]

    configs.forEach((cfg, i) => {
      const cx = MARGIN + cardW / 2 + i * (cardW + 12)
      this.createSmallCard(cx, cy, cardW, cardH, cfg)
    })
  }

  createSmallCard(cx, cy, w, h, { key, gradientTop, gradientBottom, icon, label, ribbon }) {
    this.makeRoundedRectTexture(`small-${key}`, w, h, gradientTop, gradientBottom, 20)

    const container = this.add.container(cx, cy)
    container.add(this.add.image(0, 0, `small-${key}`))
    container.add(this.add.text(0, -30, icon, { fontSize: 54 }).setOrigin(0.5))
    container.add(
      this.add.text(0, 58, label, {
        fontFamily: 'Verdana, sans-serif', fontSize: 16, color: '#ffffff', fontStyle: 'bold',
        align: 'center', wordWrap: { width: w - 20 },
      }).setOrigin(0.5)
    )

    if (ribbon) {
      const ribbonKey = `sribbon-${ribbon.text}`
      this.makeRoundedRectTexture(ribbonKey, 66, 26, ribbon.color, ribbon.color, 8)
      const ribbonBg = this.add.image(-w / 2 + 40, -h / 2 + 26, ribbonKey).setAngle(-10)
      const ribbonText = this.add.text(-w / 2 + 40, -h / 2 + 26, ribbon.text, {
        fontFamily: 'Verdana, sans-serif', fontSize: 13, color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setAngle(-10)
      container.add([ribbonBg, ribbonText])
    }

    const zone = this.makeHitZone(cx, cy, w, h)
    this.addPressFeedback(zone, container, () => {
      if (key === 'computer') {
        this.goTo('Classic')
        return
      }
      this.showToast(`Opening ${label}...`)
    })
    return container
  }

  // ---------- chat bar ----------

  createChatBar() {
    const w = CONTENT_W
    const h = 75
    const cy = 918 + h / 2
    this.makeRoundedRectTexture('chat-bar', w, h, 0x18234a, 0x18234a, h / 2, 0x3a4a78)

    const container = this.add.container(W / 2, cy)
    container.add(this.add.image(0, 0, 'chat-bar').setAlpha(0.9))
    container.add(this.add.text(-w / 2 + 40, 0, '💬', { fontSize: 26 }).setOrigin(0.5))
    container.add(
      this.add.text(-w / 2 + 76, 0, 'Click here to chat', {
        fontFamily: 'Verdana, sans-serif', fontSize: 18, color: '#cbd5e1',
      }).setOrigin(0, 0.5)
    )

    const zone = this.makeHitZone(W / 2, cy, w, h)
    this.addPressFeedback(zone, container, () => this.showToast('Opening chat...'))
  }

  // ---------- promo banners ----------

  createBanners() {
    const w = (CONTENT_W - 12) / 2
    const h = 60
    const cy = 1038 + h / 2

    this.createBanner(MARGIN + w / 2, cy, w, h, {
      key: 'banner-friend',
      gradientTop: 0xff8a5c,
      gradientBottom: 0xff5e3a,
      icon: '👥',
      text: '1 Friend Request',
      textColor: '#ffffff',
      onClick: () => this.showToast('Friend request opened'),
    })

    this.createBanner(MARGIN + w + 12 + w / 2, cy, w, h, {
      key: 'banner-coins',
      gradientTop: 0xffd85e,
      gradientBottom: 0xffb020,
      icon: '🪙',
      text: '5000 coins free!',
      textColor: '#5a3d00',
      onClick: () => {
        this.bumpCoins(5000)
        this.showToast('+5,000 coins!')
      },
    })
  }

  createBanner(cx, cy, w, h, { key, gradientTop, gradientBottom, icon, text, textColor, onClick }) {
    this.makeRoundedRectTexture(key, w, h, gradientTop, gradientBottom, h / 2)

    const container = this.add.container(cx, cy)
    container.add(this.add.image(0, 0, key))
    container.add(this.add.text(-w / 2 + 32, 0, icon, { fontSize: 22 }).setOrigin(0.5))
    container.add(
      this.add.text(-w / 2 + 58, 0, text, {
        fontFamily: 'Verdana, sans-serif', fontSize: 15, color: textColor, fontStyle: 'bold',
        wordWrap: { width: w - 90 },
      }).setOrigin(0, 0.5)
    )

    const zone = this.makeHitZone(cx, cy, w, h)
    this.addPressFeedback(zone, container, onClick)
  }

  // ---------- bottom nav ----------

  createBottomNav() {
    const h = 126
    const cy = 1120 + h / 2
    this.makeRoundedRectTexture('bottom-nav', CONTENT_W, h, 0xff6a3d, 0xff4757, 28)
    this.add.image(W / 2, cy, 'bottom-nav')

    const items = [
      { icon: '👫', label: 'Friends', badge: '1' },
      { icon: '🏆', label: 'Ranking' },
      { icon: '➕', label: 'Invite' },
      { icon: '📋', label: 'Mission' },
      { icon: '🎒', label: 'Backpack' },
      { icon: '🛒', label: 'Shop' },
    ]
    const slotW = CONTENT_W / items.length

    items.forEach((item, i) => {
      const cx = MARGIN + slotW / 2 + i * slotW
      this.createNavItem(cx, cy, slotW, h, item)
    })
  }

  createNavItem(cx, cy, slotW, slotH, { icon, label, badge }) {
    const container = this.add.container(cx, cy)
    const iconText = this.add.text(0, -20, icon, { fontSize: 30 }).setOrigin(0.5)
    const labelText = this.add.text(0, 26, label, {
      fontFamily: 'Verdana, sans-serif', fontSize: 12, color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5)
    container.add([iconText, labelText])

    if (badge) {
      const badgeBg = this.add.circle(16, -34, 11, 0xffffff).setStrokeStyle(2, 0xff3b30)
      const badgeText = this.add.text(16, -34, badge, {
        fontFamily: 'Verdana, sans-serif', fontSize: 11, color: '#ff3b30', fontStyle: 'bold',
      }).setOrigin(0.5)
      container.add([badgeBg, badgeText])
    }

    const zone = this.makeHitZone(cx, cy, slotW, slotH)
    this.addPressFeedback(zone, container, () => this.showToast(label))
  }
}
