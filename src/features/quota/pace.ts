/**
 * Usage pace for a fixed-length quota window, as T3 Code shows it: where the
 * window's remaining time sits on the bar, and whether usage runs ahead of it.
 * React- and style-free so tests can import it.
 */

export type QuotaPace = 'ahead' | 'on' | 'under';

export interface WindowPace {
  /** Share of the window's time still left, 0–100; the tick's position on a "left" bar. */
  windowLeftPercent: number;
  /** Null when usage is unknown. */
  pace: QuotaPace | null;
}

/** Usage within this many points of elapsed time counts as on pace. */
export const PACE_TOLERANCE_POINTS = 5;

export function windowPace(
  usedPercent: number | null | undefined,
  resetAtMs: number | null | undefined,
  periodHours: number | null | undefined,
  nowMs: number
): WindowPace | null {
  // A reset already behind us says nothing about the window now running.
  if (typeof resetAtMs !== 'number' || !Number.isFinite(resetAtMs) || resetAtMs <= nowMs) {
    return null;
  }
  if (typeof periodHours !== 'number' || !Number.isFinite(periodHours) || periodHours <= 0) {
    return null;
  }
  const periodMs = periodHours * 3_600_000;
  const elapsed = Math.max(0, Math.min(1, (periodMs - (resetAtMs - nowMs)) / periodMs));
  let pace: QuotaPace | null = null;
  if (typeof usedPercent === 'number' && Number.isFinite(usedPercent)) {
    const overshoot = usedPercent - elapsed * 100;
    pace =
      overshoot > PACE_TOLERANCE_POINTS
        ? 'ahead'
        : overshoot < -PACE_TOLERANCE_POINTS
          ? 'under'
          : 'on';
  }
  return { windowLeftPercent: Math.round((1 - elapsed) * 100), pace };
}
