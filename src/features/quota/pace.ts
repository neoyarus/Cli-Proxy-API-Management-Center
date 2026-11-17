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

/** Gap cut into the bar on each side of the pace tick's centre. */
const PACE_GAP_PX = 3;
/** Matches `.quotaPaceTick { width }`. */
const PACE_TICK_PX = 2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Where the tick and its gap go. Once the bar's width is known the centre is a whole pixel,
 * so the gap edges and the tick land on the same pixel grid and the gap stays even on both
 * sides; percentages alone round the mask and the tick differently. Before that (first paint,
 * server render) it falls back to percentages.
 */
export function paceGeometry(paceLeftPercent: number, widthPx: number | null) {
  if (widthPx !== null && widthPx >= PACE_GAP_PX * 2) {
    const center = Math.round(
      clamp((widthPx * paceLeftPercent) / 100, PACE_GAP_PX, widthPx - PACE_GAP_PX)
    );
    return {
      tickLeft: `${center - PACE_TICK_PX / 2}px`,
      gapStart: `${center - PACE_GAP_PX}px`,
      gapEnd: `${center + PACE_GAP_PX}px`,
    };
  }
  const at = `clamp(${PACE_GAP_PX}px, ${clamp(paceLeftPercent, 0, 100)}%, calc(100% - ${PACE_GAP_PX}px))`;
  return {
    tickLeft: `calc(${at} - ${PACE_TICK_PX / 2}px)`,
    gapStart: `calc(${at} - ${PACE_GAP_PX}px)`,
    gapEnd: `calc(${at} + ${PACE_GAP_PX}px)`,
  };
}
