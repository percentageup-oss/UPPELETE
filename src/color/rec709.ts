/**
 * The Rec.709/BT.1886 opto-electronic transfer function pair: `REC709_OETF` encodes scene-linear
 * light into the display-referred, gamma-like signal every `.cube` LUT and 8-bit frame is defined
 * over; `REC709_EOTF` is its inverse. Extended past [0, 1] with the same formula (no clamp) so a
 * still-hot highlight coming out of `applyPrimaries` keeps its relative brightness until the final
 * clamp, and so a negative excursion from an aggressive lift decodes back losslessly. Constants are
 * ITU-R BT.709-6 §1.2.
 */

const REC709_BETA = 0.018053968510807
const REC709_ALPHA = 1.09929682680944

export function REC709_OETF(linear: number): number {
  if (linear >= REC709_BETA) return REC709_ALPHA * linear ** 0.45 - (REC709_ALPHA - 1)
  if (linear <= -REC709_BETA) return -(REC709_ALPHA * (-linear) ** 0.45 - (REC709_ALPHA - 1))
  return 4.5 * linear
}

export function REC709_EOTF(encoded: number): number {
  const cut = 4.5 * REC709_BETA
  if (encoded >= cut) return ((encoded + (REC709_ALPHA - 1)) / REC709_ALPHA) ** (1 / 0.45)
  if (encoded <= -cut) return -(((-encoded + (REC709_ALPHA - 1)) / REC709_ALPHA) ** (1 / 0.45))
  return encoded / 4.5
}
