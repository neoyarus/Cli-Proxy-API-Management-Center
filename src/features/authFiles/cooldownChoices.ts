/**
 * Pause lengths offered when cooling a credential down by hand. React- and style-free
 * so tests can import it.
 */
import type { ManualCooldownRequest } from '@/services/api/authFiles';
import type { AuthFileItem } from '@/types';
import { readClaudeHeaderSnapshot } from '@/features/quota/providers/claude/data';

const HOUR_OPTIONS = [1, 3, 5, 12, 24] as const;

export type CooldownChoice = {
  id: string;
  labelKey: string;
  labelOptions?: Record<string, unknown>;
  /** End time, used for the request and shown beside the label. */
  untilMs: number;
};

/**
 * Fixed hours, plus the next 5-hour and weekly resets when the proxy has seen them in
 * Claude's rate-limit headers.
 */
export function cooldownChoices(file: AuthFileItem, nowMs: number = Date.now()): CooldownChoice[] {
  const choices: CooldownChoice[] = HOUR_OPTIONS.map((hours) => ({
    id: `hours-${hours}`,
    labelKey: 'auth_files.manual_cooldown_hours',
    labelOptions: { count: hours },
    untilMs: nowMs + hours * 3_600_000,
  }));
  const snapshot = readClaudeHeaderSnapshot(file, nowMs);
  for (const [key, labelKey] of [
    ['five_hour', 'auth_files.manual_cooldown_until_5h_reset'],
    ['seven_day', 'auth_files.manual_cooldown_until_weekly_reset'],
  ] as const) {
    const resetsAt = snapshot?.payload[key]?.resets_at;
    const untilMs = resetsAt ? Date.parse(resetsAt) : NaN;
    if (Number.isFinite(untilMs) && untilMs > nowMs) {
      choices.push({ id: key, labelKey, untilMs });
    }
  }
  return choices;
}

/** The API request for a choice: its end time as RFC 3339 without milliseconds. */
export const cooldownRequest = (choice: CooldownChoice): ManualCooldownRequest => ({
  until: new Date(choice.untilMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
});
