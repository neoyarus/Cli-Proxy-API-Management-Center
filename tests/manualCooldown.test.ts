import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { authFilesApi, readManualCooldownUntil } from '@/services/api/authFiles';
import { cooldownChoices, cooldownRequest } from '@/features/authFiles/cooldownChoices';
import type { AuthFileItem } from '@/types';

const NOW = Date.parse('2026-11-17T10:00:00Z');
const unix = (iso: string) => String(Date.parse(iso) / 1000);
const originalPost = apiClient.post;
afterEach(() => {
  apiClient.post = originalPost;
});

describe('manual credential cooldown', () => {
  test('reads only an active pause from the credential list', () => {
    expect(readManualCooldownUntil({ cooldown_until: '2026-11-17T12:00:00Z' }, NOW)).toBe(
      Date.parse('2026-11-17T12:00:00Z')
    );
    expect(readManualCooldownUntil({ cooldown_until: '2026-11-17T09:00:00Z' }, NOW)).toBeNull();
    expect(readManualCooldownUntil({ cooldown_until: '' }, NOW)).toBeNull();
    expect(readManualCooldownUntil({}, NOW)).toBeNull();
  });

  test('offers fixed hours and, with header data, the next 5h and weekly resets', () => {
    const plain = cooldownChoices({ name: 'codex.json', type: 'codex' } as AuthFileItem, NOW);
    expect(plain.map((choice) => choice.id)).toEqual([
      'hours-1',
      'hours-3',
      'hours-5',
      'hours-12',
      'hours-24',
    ]);
    expect(plain[2].untilMs).toBe(NOW + 5 * 3_600_000);

    const claude = {
      name: 'claude.json',
      type: 'claude',
      quota: {
        observed_at: '2026-11-17T09:58:00Z',
        signals: {
          'Anthropic-Ratelimit-Unified-5h-Utilization': '0.4',
          'Anthropic-Ratelimit-Unified-5h-Reset': unix('2026-11-17T12:30:00Z'),
          'Anthropic-Ratelimit-Unified-7d-Utilization': '0.9',
          'Anthropic-Ratelimit-Unified-7d-Reset': unix('2026-11-19T08:00:00Z'),
        },
      },
    } as unknown as AuthFileItem;
    const choices = cooldownChoices(claude, NOW);
    expect(
      choices.slice(-2).map((choice) => [choice.id, new Date(choice.untilMs).toISOString()])
    ).toEqual([
      ['five_hour', '2026-11-17T12:30:00.000Z'],
      ['seven_day', '2026-11-19T08:00:00.000Z'],
    ]);
    expect(cooldownRequest(choices[choices.length - 1])).toEqual({ until: '2026-11-19T08:00:00Z' });
  });

  test('sends a pause and a resume to the cooldown endpoint', async () => {
    const calls: Array<[string, unknown]> = [];
    apiClient.post = (async (path: string, body: unknown) => {
      calls.push([path, body]);
      return { status: 'ok', cooldown_until: '' };
    }) as typeof apiClient.post;
    await authFilesApi.setManualCooldown('claude-n.json', 'idx-1', {
      until: '2026-11-17T12:00:00Z',
    });
    await authFilesApi.setManualCooldown('claude-n.json', undefined, { durationSeconds: 3600 });
    await authFilesApi.setManualCooldown('claude-n.json', 'idx-1', null);
    expect(calls).toEqual([
      [
        '/credentials/cooldown',
        { name: 'claude-n.json', auth_index: 'idx-1', until: '2026-11-17T12:00:00Z' },
      ],
      ['/credentials/cooldown', { name: 'claude-n.json', duration_seconds: 3600 }],
      ['/credentials/cooldown', { name: 'claude-n.json', auth_index: 'idx-1' }],
    ]);
  });

  test('the card offers cool down / resume and the page wires the handler', () => {
    const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const card = read('src/features/authFiles/components/AuthFileCard.tsx');
    const footer = card.split('<footer')[1].split('</footer>')[0];
    expect(footer).toContain('<IconTimer size={15} />');
    expect(footer).toContain(
      'cooldownUntil !== null ? void changeCooldown(null) : setCooldownDialogOpen(true)'
    );
    expect(footer).toContain("'auth_files.manual_cooldown_resume'");
    expect(card).toContain("t('auth_files.manual_cooldown_active', {");
    expect(card).toContain('<AuthFileCooldownDialog');
    const page = read('src/features/authFiles/AuthFilesPage.tsx');
    expect(page).toContain('onManualCooldown={handleManualCooldown}');
  });
});
