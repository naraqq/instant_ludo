export const W = 720

// The canvas is a fixed 720 wide; its height tracks the real viewport aspect so
// Scale.FIT fills the screen with no letterbox. Capped so the play area stays
// width-constrained (board spans the full width) on tall phones and doesn't
// collapse on short / landscape windows.
function computeHeight() {
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 720
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 1280
  return Math.round(Math.min(1900, Math.max(1180, (W * vh) / vw)))
}

export const H = computeHeight()

// Classic / Net scenes centre their board with BOARD_Y = (H - BOARD_SIZE) / 2.
// HomeScene positions its content absolutely for a 1280 canvas, so it nudges
// everything down by this to stay centred on the taller canvas.
export const HOME_V = Math.round((H - 1280) / 2)

// The game is authored in a fixed W-wide space, but on high-DPI phones a
// W-wide canvas stretched to fill the screen is upscaled and looks soft. We
// render the canvas at RENDER_SCALE x the logical size and zoom every camera
// by the same factor, so one game unit maps to RENDER_SCALE device-ish pixels
// and text / board / sprites stay crisp. Capped at 2 - beyond that the memory
// and fill cost isn't worth the barely-visible gain.
export const RENDER_SCALE = (() => {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  return Math.min(2, Math.max(1, Math.round(dpr * 2) / 2))
})()

export const MARGIN = 24
export const CONTENT_W = W - MARGIN * 2
