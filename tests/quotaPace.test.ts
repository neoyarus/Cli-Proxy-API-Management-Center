import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { paceGeometry, windowPace } from '@/features/quota/pace';
import { QuotaMeter } from '@/features/quota/components/QuotaMeter';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import type { ClaudeQuotaState } from '@/types';

const translations = i18n.cloneInstance({ lng: 'en' });
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'quota-pace-test'
);
const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-17T19:30:00Z');

describe('window pace', () => {
  test('places the tick at the share of the window still left', () => {
    // 5h window resetting in 3h20m: 1h40m (a third) has elapsed.
    const reset = NOW + 3 * HOUR + 20 * 60_000;
    expect(windowPace(31, reset, 5, NOW)).toEqual({ windowLeftPercent: 67, pace: 'on' });
    expect(windowPace(40, reset, 5, NOW)?.pace).toBe('ahead');
    expect(windowPace(10, reset, 5, NOW)?.pace).toBe('under');
    // Weekly window with 2.5 days left: 64% elapsed.
    expect(windowPace(5, NOW + 60 * HOUR, 168, NOW)).toEqual({
      windowLeftPercent: 36,
      pace: 'under',
    });
  });

  test('gives no pace without a future reset or a known window length', () => {
    expect(windowPace(50, NOW - HOUR, 5, NOW)).toBeNull();
    expect(windowPace(50, null, 5, NOW)).toBeNull();
    expect(windowPace(50, NOW + HOUR, null, NOW)).toBeNull();
    expect(windowPace(null, NOW + HOUR, 5, NOW)).toEqual({ windowLeftPercent: 20, pace: null });
  });

  test('the meter draws a tick with a gap only when given a pace', () => {
    const plain = renderToStaticMarkup(createElement(QuotaMeter, { percent: 69, classes }));
    expect(plain).not.toContain('quotaPaceTick');
    expect(plain.startsWith('<div class="quotaBar">')).toBe(true);

    const paced = renderToStaticMarkup(
      createElement(QuotaMeter, {
        percent: 69,
        classes,
        paceLeftPercent: 64,
        paceTitle: '64% of the window left',
      })
    );
    expect(paced).toContain('class="quotaMeter" title="64% of the window left"');
    // Before the bar is measured (here: server render) the position is a percentage.
    expect(paced).toContain(
      'class="quotaPaceTick" style="left:calc(clamp(3px, 64%, calc(100% - 3px)) - 1px)"'
    );
    expect(paced).toContain(
      'mask-image:linear-gradient(to right, #000 calc(clamp(3px, 64%, calc(100% - 3px)) - 3px)'
    );
  });

  test('once measured, the tick and its gap share one whole-pixel centre', () => {
    // 64% of 437px is 279.68px: both the gap and the tick centre on 280px.
    expect(paceGeometry(64, 437)).toEqual({
      tickLeft: '279px',
      gapStart: '277px',
      gapEnd: '283px',
    });
    // Kept inside the bar's ends.
    expect(paceGeometry(0, 437)).toEqual({ tickLeft: '2px', gapStart: '0px', gapEnd: '6px' });
    expect(paceGeometry(100, 437)).toEqual({
      tickLeft: '433px',
      gapStart: '431px',
      gapEnd: '437px',
    });
  });
});

describe('Claude quota card', () => {
  const render = (state: ClaudeQuotaState) =>
    renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: translations },
        createElement(ClaudeQuotaBody, { quota: state, classes })
      )
    );

  test('shows the pace arrow and tick, and the source line under the limits', () => {
    const now = Date.now();
    const html = render({
      status: 'success',
      source: 'headers',
      observedAt: new Date(now - 60_000).toISOString(),
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          usedPercent: 31,
          resetLabel: '',
          resetAtMs: now + 3 * HOUR + 20 * 60_000,
          periodHours: 5,
        },
        {
          id: 'seven-day',
          label: 'Weekly limit',
          usedPercent: 90,
          resetLabel: '',
          resetAtMs: now + 60 * HOUR,
          periodHours: 168,
        },
      ],
    });
    expect(html).toContain('data-quota-pace="on"');
    expect(html).toContain('data-quota-pace="ahead"');
    expect(html).toContain('aria-label="Ahead of pace: spending faster than the window elapses"');
    expect(html.match(/class="quotaPaceTick"/g)?.length).toBe(2);
    expect(html.indexOf('data-quota-source="headers"')).toBeGreaterThan(
      html.lastIndexOf('quotaPaceTick')
    );
  });
});

describe('auth file card header', () => {
  test('shows the provider logo, with the text badge only as a fallback', () => {
    const card = readFileSync(
      new URL('../src/features/authFiles/components/AuthFileCard.tsx', import.meta.url),
      'utf8'
    );
    const header = card.split('<h3 className={styles.identity}>')[1].split('</h3>')[0];
    expect(header).toContain('{providerIcon ? (');
    expect(header).toContain('<img src={providerIcon} alt={typeLabel} />');
    expect(header.indexOf('styles.providerIcon')).toBeLessThan(
      header.indexOf('styles.providerBadge')
    );
  });
});
