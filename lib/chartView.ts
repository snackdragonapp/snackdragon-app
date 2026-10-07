// lib/chartView.ts
// Pure math for the charts' horizontal zoom window. A view is a fractional
// [start, start + len) slice of the per-day rows; null means "everything".
// Fractions are kept between gestures so many small trackpad steps don't drift.

export type View = { start: number; len: number };

/** Never zoom in past this many days. */
export const MIN_VIEW_DAYS = 7;

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Integer slice for rendering. */
export function resolveView(view: View | null, n: number): { start: number; len: number } {
  if (!view || n === 0) return { start: 0, len: n };
  const len = clamp(Math.round(view.len), Math.min(MIN_VIEW_DAYS, n), n);
  const start = clamp(Math.round(view.start), 0, n - len);
  return { start, len };
}

/** Clamps a candidate window to the data; collapses to null when it covers everything. */
export function normalizeView(start: number, len: number, n: number): View | null {
  if (n === 0) return null;
  const l = clamp(len, Math.min(MIN_VIEW_DAYS, n), n);
  if (l >= n) return null;
  return { start: clamp(start, 0, n - l), len: l };
}

/**
 * Scales the window by `factor` (>1 zooms out) keeping the row at fraction `f`
 * of the plot width (0 = left edge, 1 = right edge) under the pointer.
 */
export function zoomView(prev: View | null, n: number, f: number, factor: number): View | null {
  const cur = prev ?? { start: 0, len: n };
  const len = cur.len * factor;
  const anchor = cur.start + f * cur.len;
  return normalizeView(anchor - f * len, len, n);
}

/** Shifts the window by a fraction of its own width (positive = later dates). */
export function panView(base: View, n: number, fractionOfWidth: number): View | null {
  return normalizeView(base.start + fractionOfWidth * base.len, base.len, n);
}

/**
 * Two-finger gesture: `dist0`/`f0` from the gesture start, `dist`/`f` now.
 * Spreading the fingers zooms in; moving the midpoint pans.
 */
export function pinchView(
  base: View | null,
  n: number,
  dist0: number,
  f0: number,
  dist: number,
  f: number
): View | null {
  const cur = base ?? { start: 0, len: n };
  const len = cur.len * (dist0 / Math.max(1, dist));
  const anchor = cur.start + f0 * cur.len;
  return normalizeView(anchor - f * len, len, n);
}

/** The last `days` rows, or null when that is the whole history. */
export function presetView(days: number | null, n: number): View | null {
  if (days === null) return null;
  return normalizeView(n - days, days, n);
}
