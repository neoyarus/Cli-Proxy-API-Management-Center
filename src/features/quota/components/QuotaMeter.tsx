/**
 * 额度水位条（原 QuotaProgressBar 的类型化后继）。
 *
 * dataviz 语法：细轨道退居背景，填充按剩余量三档着色（≥70 绿 / ≥30 琥珀 / <30 红），
 * percent === null 渲染空轨道 —— 未知不着色（Medium 类在 width 0 下不可见，行为与旧版一致）。
 * `index` 写入 `--meter-index`，供全页外衣做逐行入场级差；紧凑外衣不消费该变量。
 *
 * With `paceLeftPercent` (share of the window's time still left) a tick marks where the
 * remaining quota would sit on pace, with a small gap cut into the bar around it.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { QuotaClassMap } from '../types';

export const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
export const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;

/** Gap cut into the bar on each side of the pace tick's centre. */
const PACE_GAP_PX = 3;
/** Matches `.quotaPaceTick { width }`. */
const PACE_TICK_PX = 2;

export interface QuotaMeterProps {
  percent: number | null;
  classes: QuotaClassMap;
  index?: number;
  /** Share of the window's time still left, 0–100; null or absent draws no tick. */
  paceLeftPercent?: number | null;
  /** Tooltip for the bar when the tick is shown. */
  paceTitle?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Where the tick and its gap go. Once the bar's width is known the centre is a whole pixel,
 * so the gap edges and the tick land on the same pixel grid and the gap stays even on both
 * sides; percentages alone round the mask and the tick differently. Before that (first paint,
 * server render) it falls back to percentages.
 */
export function paceGeometry(paceLeftPercent: number, widthPx: number | null) {
  if (widthPx !== null && widthPx >= PACE_GAP_PX * 2) {
    const center = Math.round(clamp((widthPx * paceLeftPercent) / 100, PACE_GAP_PX, widthPx - PACE_GAP_PX));
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

export function QuotaMeter({
  percent,
  classes,
  index,
  paceLeftPercent = null,
  paceTitle,
}: QuotaMeterProps) {
  const hasPace = paceLeftPercent !== null && Number.isFinite(paceLeftPercent);
  const meterRef = useRef<HTMLDivElement>(null);
  const [widthPx, setWidthPx] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = meterRef.current;
    if (!hasPace || !element) return;
    // clientWidth is the layout width, unaffected by the card's entrance transforms.
    const update = () => setWidthPx(element.clientWidth || null);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasPace]);

  const normalized = percent === null ? null : clamp(percent, 0, 100);
  const fillClass =
    normalized === null
      ? classes.quotaBarFillMedium
      : normalized >= QUOTA_PROGRESS_HIGH_THRESHOLD
        ? classes.quotaBarFillHigh
        : normalized >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
          ? classes.quotaBarFillMedium
          : classes.quotaBarFillLow;
  const widthPercent = Math.round((normalized ?? 0) * 100) / 100;
  const style: CSSProperties & { '--meter-index'?: number } = { width: `${widthPercent}%` };
  if (index !== undefined) {
    style['--meter-index'] = index;
  }
  const fill = <div className={`${classes.quotaBarFill} ${fillClass}`} style={style} />;

  if (!hasPace || paceLeftPercent === null) {
    return <div className={classes.quotaBar}>{fill}</div>;
  }

  const { tickLeft, gapStart, gapEnd } = paceGeometry(paceLeftPercent, widthPx);
  const mask = `linear-gradient(to right, #000 ${gapStart}, transparent ${gapStart}, transparent ${gapEnd}, #000 ${gapEnd})`;

  return (
    <div
      ref={meterRef}
      className={classes.quotaMeter}
      title={paceTitle}
      data-quota-pace-left={paceLeftPercent}
    >
      <div className={classes.quotaBar} style={{ maskImage: mask, WebkitMaskImage: mask }}>
        {fill}
      </div>
      <span className={classes.quotaPaceTick} style={{ left: tickLeft }} aria-hidden="true" />
    </div>
  );
}
