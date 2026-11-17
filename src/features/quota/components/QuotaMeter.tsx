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
import { paceGeometry } from '../pace';
import type { QuotaClassMap } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
export const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;

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
