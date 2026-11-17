import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { apiCallApi, type ApiCallResult } from '@/services/api/apiCall';
import { authFilesApi } from '@/services/api/authFiles';
import {
  CLAUDE_CONFIG,
  readClaudeHeaderSnapshot,
} from '@/features/quota/providers/claude/data';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { CLAUDE_USAGE_URL } from '@/utils/quota';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';

const translations = i18n.cloneInstance({ lng: 'en' });
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'claude-header-test'
);
const NOW = Date.parse('2026-11-17T10:00:00Z');
const unix = (iso: string) => String(Date.parse(iso) / 1000);

const headerFile = (fiveHour: string, sevenDay: string, observedAt = '2026-11-17T09:58:00Z') =>
  ({
    name: 'claude-setup.json',
    type: 'claude',
    authIndex: 'idx-setup',
    quota: {
      observed_at: observedAt,
      signals: {
        'Anthropic-Ratelimit-Unified-5h-Utilization': fiveHour,
        'Anthropic-Ratelimit-Unified-5h-Reset': unix('2026-11-17T12:00:00Z'),
        'Anthropic-Ratelimit-Unified-7d-Utilization': sevenDay,
        'Anthropic-Ratelimit-Unified-7d-Reset': unix('2026-11-18T20:00:00Z'),
        'Anthropic-Ratelimit-Unified-7d-Status': 'allowed_warning',
      },
    },
  }) as unknown as AuthFileItem;

const result = (statusCode: number, body: unknown): ApiCallResult => ({
  statusCode,
  header: {},
  body,
  bodyText: JSON.stringify(body),
});

const originalRequest = apiCallApi.request;
const originalList = authFilesApi.list;
afterEach(() => {
  apiCallApi.request = originalRequest;
  authFilesApi.list = originalList;
});

describe('Claude quota from response headers', () => {
  test('reads the 5h and 7d windows from the passive header snapshot', () => {
    const snapshot = readClaudeHeaderSnapshot(headerFile('0.44', '0.87'), NOW)!;
    expect(snapshot.observedAt).toBe('2026-11-17T09:58:00.000Z');
    expect(snapshot.payload.five_hour).toEqual({
      utilization: 44,
      resets_at: '2026-11-17T12:00:00.000Z',
    });
    expect(snapshot.payload.seven_day).toEqual({
      utilization: 87,
      resets_at: '2026-11-18T20:00:00.000Z',
    });
  });

  test('a window whose reset has passed restarts at 0% with the next reset', () => {
    const file = headerFile('0.9', '0.5');
    const later = Date.parse('2026-11-17T13:30:00Z'); // 5h window reset at 12:00
    const snapshot = readClaudeHeaderSnapshot(file, later)!;
    expect(snapshot.payload.five_hour).toEqual({
      utilization: 0,
      resets_at: '2026-11-17T17:00:00.000Z',
    });
    expect(snapshot.payload.seven_day?.utilization).toBe(50);
  });

  test('returns null without usable header data', () => {
    expect(readClaudeHeaderSnapshot({ name: 'x', type: 'claude' } as AuthFileItem)).toBeNull();
    const noUsage = {
      name: 'x',
      type: 'claude',
      quota: { signals: { 'Anthropic-Ratelimit-Unified-Status': 'allowed' } },
    } as unknown as AuthFileItem;
    expect(readClaudeHeaderSnapshot(noUsage)).toBeNull();
  });

  test('falls back to the newest header snapshot when the usage API refuses the token', async () => {
    apiCallApi.request = async (request) =>
      request.url === CLAUDE_USAGE_URL
        ? result(403, { error: { type: 'permission_error' } })
        : result(403, null);
    const lookups: unknown[] = [];
    authFilesApi.list = async (lookup) => {
      lookups.push(lookup);
      return { files: [headerFile('0.10', '0.20', '2026-11-17T09:59:30Z')], total: 1 };
    };

    const data = await CLAUDE_CONFIG.fetchQuota(headerFile('0.44', '0.87'), translations.t);
    expect(lookups).toEqual([{ name: 'claude-setup.json', authIndex: 'idx-setup' }]);
    expect(data.source).toBe('headers');
    expect(data.observedAt).toBe('2026-11-17T09:59:30.000Z');
    expect(data.windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['five-hour', 10],
      ['seven-day', 20],
    ]);
    expect(data.extraUsage).toBeNull();
    expect(data.planType).toBeNull();
  });

  test('uses the page copy of the snapshot when the lookup fails', async () => {
    apiCallApi.request = async () => result(403, null);
    authFilesApi.list = async () => {
      throw new Error('offline');
    };
    const data = await CLAUDE_CONFIG.fetchQuota(headerFile('0.44', '0.87'), translations.t);
    expect(data.source).toBe('headers');
    expect(data.windows.map((window) => window.usedPercent)).toEqual([44, 87]);
  });

  test('still reports the error when there is no header snapshot either', async () => {
    apiCallApi.request = async () => result(403, null);
    authFilesApi.list = async () => ({ files: [], total: 0 });
    const file = { name: 'claude-none.json', type: 'claude', authIndex: 'idx' } as AuthFileItem;
    await expect(CLAUDE_CONFIG.fetchQuota(file, translations.t)).rejects.toThrow();
  });

  test('live usage is marked as live', async () => {
    apiCallApi.request = async (request) =>
      request.url === CLAUDE_USAGE_URL
        ? result(200, { five_hour: { utilization: 12, resets_at: '2026-11-17T12:00:00Z' } })
        : result(200, null);
    const data = await CLAUDE_CONFIG.fetchQuota(headerFile('0.44', '0.87'), translations.t);
    expect(data.source).toBe('live');
    expect(CLAUDE_CONFIG.buildSuccessState(data).source).toBe('live');
  });

  test('the card names the header source and its time', () => {
    const state: ClaudeQuotaState = {
      status: 'success',
      windows: [],
      observedAt: '2026-11-17T09:58:00Z',
      source: 'headers',
    };
    const html = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: translations },
        createElement(ClaudeQuotaBody, { quota: state, classes })
      )
    );
    expect(html).toContain('data-quota-source="headers"');
    expect(html).toContain('Source');
    expect(html).toContain('response headers, ');

    const live = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: translations },
        createElement(ClaudeQuotaBody, { quota: { ...state, source: 'live' }, classes })
      )
    );
    expect(live).not.toContain('data-quota-source');
  });
});
