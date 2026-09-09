export const W = 720
// Portrait canvas. Aspect ~0.47 so Scale.FIT leaves almost no letterbox on a
// typical tall phone (most sit around 0.46); the board still fills the width.
export const H = 1520
// HomeScene was laid out for a 1280-tall canvas; this keeps its content centred.
export const HOME_V = (H - 1280) / 2
export const MARGIN = 24
export const CONTENT_W = W - MARGIN * 2
