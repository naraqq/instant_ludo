// Minimal i18n. t('key', { n: 3 }) does {placeholder} substitution and falls
// back to English, then to the raw key. Locale is persisted via the store.

import { store } from './store.js'

export const LOCALES = ['en', 'mn']
export const LOCALE_LABEL = { en: 'EN', mn: 'МОН' }

const STRINGS = {
  en: {
    'common.done': 'DONE',
    'common.on': 'On',
    'common.off': 'Off',
    'common.easy': 'EASY',
    'common.normal': 'NORMAL',
    'common.hard': 'HARD',

    'color.red': 'RED',
    'color.green': 'GREEN',
    'color.yellow': 'YELLOW',
    'color.blue': 'BLUE',

    'home.tagline': 'roll · race · unleash the elements',
    'home.level': 'LEVEL {n}',
    'home.play': 'PLAY',
    'home.modeHint': '2–4 players · Solo or local',
    'home.dailyTitle': 'Daily reward',
    'home.dailyClaim': 'Your coins are ready. Tap to collect.',
    'home.settings': 'Settings',
    'home.stats': 'Stats',
    'home.powersTitle': 'ELEMENTAL POWERS',
    'home.powerFire': 'Double your roll',
    'home.powerWater': 'Pick your number',
    'home.powerEarth': 'Shield your pawns',
    'home.powerAir': 'Take an extra turn',
    'home.record': '{n} matches · {p}% wins · best streak {s}',
    'home.firstMatch': 'Play your first match',
    'home.dailyReady': 'Daily bonus ready — tap to claim {n}',
    'home.dailyWait': 'Next daily bonus in {h}h {m}m',
    'home.dailyRecharge': 'Daily bonus recharges every 20 hours',
    'home.coinsGained': '+{n} coins!',
    'home.xpOf': '{a} / {b} XP',

    'setup.title': 'NEW GAME',
    'setup.opponents': 'OPPONENTS',
    'setup.playAgainst': 'PLAY AGAINST',
    'setup.computer': 'Computer',
    'setup.local': 'Local',
    'setup.difficulty': 'BOT DIFFICULTY',
    'setup.start': 'START MATCH',

    'settings.title': 'SETTINGS',
    'settings.sound': 'Sound',
    'settings.haptics': 'Haptics',
    'settings.difficulty': 'DEFAULT BOT DIFFICULTY',
    'settings.language': 'LANGUAGE',
    'settings.reset': 'RESET PROGRESS',
    'settings.resetConfirm': 'Tap Reset again to confirm',

    'stats.title': 'YOUR RECORD',
    'stats.matches': 'Matches played',
    'stats.wins': 'Wins',
    'stats.captures': 'Pawns captured',
    'stats.streak': 'Best win streak',
    'stats.coins': 'Coins',

    'classic.you': 'You',
    'classic.cpu': 'CPU {n}',
    'classic.rolling': 'Rolling…',
    'classic.yourTurn': 'Your turn',
    'classic.tapDice': 'tap your dice to roll',
    'classic.luckyReady': 'Lucky roll ready ★',
    'classic.luckyHint': 'a 6 is guaranteed — tap your dice',
    'classic.youRolled': 'You rolled {n}',
    'classic.tapPawn': 'tap a glowing pawn',
    'classic.youRolledNoMove': 'You rolled {n} — no move',
    'classic.botRolled': '{name} rolled {n}',
    'classic.botMoving': 'moving…',
    'classic.botTurn': "{name}'s turn",
    'classic.botRolling': 'rolling…',
    'classic.noMove': 'No legal move',
    'classic.leaveConfirm': 'Tap back again to leave the match',
    'classic.timeUp': 'Time up — auto play',
    'classic.chooseDice': 'Choose dice number',
    'classic.fireActive': 'Fire active — your next roll counts twice',
    'classic.earthActive': 'Earth shield up until your next roll',
    'classic.airCollected': 'Air rune — you roll again after this move',

    'victory.youWin': 'YOU WIN!',
    'victory.defeat': 'DEFEAT',
    'victory.colorWins': '{color} WINS',
    'victory.allHome': '{color} got all four pawns home',
    'victory.place1': '1st',
    'victory.place2': '2nd',
    'victory.place3': '3rd',
    'victory.place4': '4th',
    'victory.bot': '{color} BOT',
    'victory.home4': '{n}/4 home',
    'victory.reward': '+{c} coins    +{x} XP',
    'victory.captureBonus': 'includes +{n} capture bonus ({k} sent home)',
    'victory.levelUp': 'LEVEL UP!   You are now level {n}',
    'victory.noRewards': 'Local match — no rewards',
    'victory.rematch': 'REMATCH',
    'victory.home': 'HOME',
  },

  mn: {
    'common.done': 'БОЛОО',
    'common.on': 'Тийм',
    'common.off': 'Үгүй',
    'common.easy': 'АМАРХАН',
    'common.normal': 'ДУНД',
    'common.hard': 'ХЭЦҮҮ',

    'color.red': 'УЛААН',
    'color.green': 'НОГООН',
    'color.yellow': 'ШАР',
    'color.blue': 'ХӨХ',

    'home.modeHint': '2–4 тоглогч · Ганцаараа эсвэл хамт',
    'home.dailyTitle': 'Өдрийн урамшуулал',
    'home.dailyClaim': 'Зоос бэлэн. Дарж аваарай.',
    'home.tagline': 'шоо хая · уралд · хүчээ дэлгэ',
    'home.level': '{n}-Р ТҮВШИН',
    'home.play': 'ТОГЛОХ',
    'home.settings': 'Тохиргоо',
    'home.stats': 'Амжилт',
    'home.powersTitle': 'ХҮЧНҮҮД',
    'home.powerFire': 'Шоог хоёр дахин',
    'home.powerWater': 'Тоогоо сонгох',
    'home.powerEarth': 'Хүүгээ хамгаалах',
    'home.powerAir': 'Нэмэлт ээлж авах',
    'home.record': '{n} тоглолт · {p}% ялалт · {s} дараалсан',
    'home.firstMatch': 'Эхний тоглолтоо тогло',
    'home.dailyReady': 'Өдрийн бэлэг бэлэн — {n} авах',
    'home.dailyWait': 'Дараагийн бэлэг {h}ц {m}мин дараа',
    'home.dailyRecharge': 'Өдрийн бэлэг 20 цаг тутам сэргэнэ',
    'home.coinsGained': '+{n} зоос!',
    'home.xpOf': '{a} / {b} XP',

    'setup.title': 'ШИНЭ ТОГЛОЛТ',
    'setup.opponents': 'ӨРСӨЛДӨГЧ',
    'setup.playAgainst': 'ЭСРЭГ ТАЛ',
    'setup.computer': 'Компьютер',
    'setup.local': 'Ээлжлэн',
    'setup.difficulty': 'БОТЫН ХҮНДРЭЛ',
    'setup.start': 'ЭХЛҮҮЛЭХ',

    'settings.title': 'ТОХИРГОО',
    'settings.sound': 'Дуу',
    'settings.haptics': 'Чичиргээ',
    'settings.difficulty': 'БОТЫН ХҮНДРЭЛ',
    'settings.language': 'ХЭЛ',
    'settings.reset': 'ДАХИН ЭХЛЭХ',
    'settings.resetConfirm': 'Баталгаажуулахын тулд дахин дар',

    'stats.title': 'ТАНЫ АМЖИЛТ',
    'stats.matches': 'Тоглосон',
    'stats.wins': 'Ялалт',
    'stats.captures': 'Идсэн хүү',
    'stats.streak': 'Дараалсан ялалт',
    'stats.coins': 'Зоос',

    'classic.you': 'Та',
    'classic.cpu': 'БОТ {n}',
    'classic.rolling': 'Хаяж байна…',
    'classic.yourTurn': 'Таны ээлж',
    'classic.tapDice': 'шоогоо дарж хая',
    'classic.luckyReady': 'Азтай шоо бэлэн ★',
    'classic.luckyHint': 'зургаа гарна — шоогоо дар',
    'classic.youRolled': 'Та {n} хаялаа',
    'classic.tapPawn': 'гэрэлтэж буй хүүг дар',
    'classic.youRolledNoMove': 'Та {n} хаялаа — явах хүү алга',
    'classic.botRolled': '{name} {n} хаялаа',
    'classic.botMoving': 'явж байна…',
    'classic.botTurn': '{name}-ийн ээлж',
    'classic.botRolling': 'хаяж байна…',
    'classic.noMove': 'Явах хүү алга',
    'classic.leaveConfirm': 'Гарахын тулд буцах товчийг дахин дар',
    'classic.timeUp': 'Цаг дууслаа — автоматаар',
    'classic.chooseDice': 'Тоо сонго',
    'classic.fireActive': 'Гал идэвхжлээ — дараагийн шоо хоёр дахин',
    'classic.earthActive': 'Шороон хамгаалалт дараагийн ээлж хүртэл',
    'classic.airCollected': 'Салхи — энэ явалтын дараа дахин хаяна',

    'victory.youWin': 'ТА ЯЛЛАА!',
    'victory.defeat': 'ХОЖИГДЛОО',
    'victory.colorWins': '{color} ЯЛЛАА',
    'victory.allHome': '{color} дөрвөн хүүгээ гэртээ оруулав',
    'victory.place1': '1-Р',
    'victory.place2': '2-Р',
    'victory.place3': '3-Р',
    'victory.place4': '4-Р',
    'victory.bot': '{color} БОТ',
    'victory.home4': '{n}/4 гэрт',
    'victory.reward': '+{c} зоос    +{x} XP',
    'victory.captureBonus': '+{n} идэлтийн урамшуулал ({k} хүү буцаав)',
    'victory.levelUp': 'ТҮВШИН АХЛАА!   Одоо {n}-р түвшин',
    'victory.noRewards': 'Дотоод тоглолт — урамшуулалгүй',
    'victory.rematch': 'ДАХИН',
    'victory.home': 'НҮҮР',
  },
}

let locale = LOCALES.includes(store.locale) ? store.locale : 'en'

export function getLocale() {
  return locale
}

export function setLocale(next) {
  if (!LOCALES.includes(next)) return
  locale = next
  store.setSetting('locale', next)
}

export function t(key, params) {
  let s = STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v)
  }
  return s
}
