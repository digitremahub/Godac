/**
 * A custom organisation accent color is only safe to use as a *fill*
 * (a button, a badge background, the logo placeholder) — its own
 * foreground gets chosen for that specific shape. Used directly as
 * *text* on the app's light background, an arbitrary picked color
 * (pastel yellow, light pink, pale blue…) can fail contrast entirely.
 * This mirrors the teal/orange/gold → teal-ink/orange-ink/gold-ink
 * treatment from the light-theme conversion, but computed for
 * whatever color an organisation actually picks instead of three
 * fixed brand hues.
 */

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Relative luminance (WCAG), 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const linearize = (channel: number) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const r = linearize(parseInt(hex.slice(1, 3), 16) / 255);
  const g = linearize(parseInt(hex.slice(3, 5), 16) / 255);
  const b = linearize(parseInt(hex.slice(5, 7), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

const PAPER = "#F6F7FB";
const TARGET_RATIO = 4.5; // WCAG AA for normal text

/**
 * Darkens (or lightens, for an already-dark pick) a color in HSL
 * space until it reads clearly as text on the app's light
 * background, without changing its hue — so a customer's chosen
 * brand color still feels like their brand, just readable.
 */
export function textSafeVariant(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  if (contrastRatio(hex, PAPER) >= TARGET_RATIO) return hex;

  const [h, s, l] = hexToHsl(hex);
  for (let step = 1; step <= 20; step++) {
    const candidateL = Math.max(0, l - step * 0.04);
    const candidate = hslToHex(h, Math.max(s, 0.35), candidateL);
    if (contrastRatio(candidate, PAPER) >= TARGET_RATIO) return candidate;
  }
  return hslToHex(h, Math.max(s, 0.35), 0.15);
}
