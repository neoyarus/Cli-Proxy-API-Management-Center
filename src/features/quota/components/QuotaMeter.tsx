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

import type { CSSProperties } from 'react';
import type { QuotaClassMap } from '../types';

export const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
export const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;

/** Half the gap cut into the bar on each side of the pace tick. */
const PACE_GAP_PX = 3;

export interface QuotaMeterProps {
  percent: number | null;
  classes: QuotaClassMap;
  index?: number;
  /** Share of the window's time still left, 0–100; null or absent draws no tick. */
  paceLeftPercent?: number | null;
  /** Tooltip for the bar when the tick is shown. */
  paceTitle?: string;
}

export function QuotaMeter({
  percent,
  classes,
  index,
  paceLeftPercent = null,
  paceTitle,
}: QuotaMeterProps) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
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

  if (paceLeftPercent === null || !Number.isFinite(paceLeftPercent)) {
    return <div className={classes.quotaBar}>{fill}</div>;
  }

  // Kept inside the rounded ends so the tick never sits on the bar's edge.
  const at = `clamp(${PACE_GAP_PX}px, ${clamp(paceLeftPercent, 0, 100)}%, calc(100% - ${PACE_GAP_PX}px))`;
  const gapStart = `calc(${at} - ${PACE_GAP_PX}px)`;
  const gapEnd = `calc(${at} + ${PACE_GAP_PX}px)`;
  const mask = `linear-gradient(to right, #000 ${gapStart}, transparent ${gapStart}, transparent ${gapEnd}, #000 ${gapEnd})`;

  return (
    <div className={classes.quotaMeter} title={paceTitle} data-quota-pace-left={paceLeftPercent}>
      <div className={classes.quotaBar} style={{ maskImage: mask, WebkitMaskImage: mask }}>
        {fill}
      </div>
      <span className={classes.quotaPaceTick} style={{ left: at }} aria-hidden="true" />
    </div>
  );
}
