/**
 * Claude quota data: plan windows, extra usage, and independent dollar balances.
 * React-free and SCSS-free so fixture tests can consume the data layer directly.
 */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  ClaudeDollarWindow,
  ClaudeExtraUsage,
  ClaudeProfileResponse,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  ClaudeUsageWindow,
  ClaudeUsagePayload,
} from '@/types';
import { apiCallApi, authFilesApi, getApiCallErrorMessage } from '@/services/api';
import { normalizeClaudeUsageSnapshot } from '@/services/api/claudeUsage';
import {
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_WINDOW_KEYS,
  claudePeriodHours,
  normalizeNumberValue,
  normalizeStringValue,
  parseClaudeUsagePayload,
  formatQuotaResetTime,
  resolveResetMs,
  createStatusError,
  isClaudeFile,
  isDisabledAuthFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

export type ClaudeQuotaData = {
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
  dollarWindows: ClaudeDollarWindow[];
  observedAt: string;
  /** 'headers' when the usage API failed and the proxy's response-header snapshot is shown. */
  source?: 'live' | 'headers';
};

/** Rate-limit headers CPA keeps per credential (auth file `quota.signals`), by usage-API key. */
const CLAUDE_HEADER_WINDOWS = [
  { key: 'five_hour', prefix: 'anthropic-ratelimit-unified-5h-', periodMs: 5 * 3600 * 1000 },
  { key: 'seven_day', prefix: 'anthropic-ratelimit-unified-7d-', periodMs: 7 * 24 * 3600 * 1000 },
] as const;

export type ClaudeHeaderSnapshot = { payload: ClaudeUsagePayload; observedAt: string };

/**
 * Usage windows from the rate-limit headers of the credential's latest response, which
 * CPA exposes as the auth file's `quota` ({observed_at, signals}). This needs no request,
 * so it also covers credentials whose token cannot call the usage API (setup tokens are
 * inference-only). A reset already in the past means the window restarted since the
 * snapshot: usage is shown as 0 and the reset moves forward by whole periods.
 */
export const readClaudeHeaderSnapshot = (
  file: AuthFileItem,
  nowMs: number = Date.now()
): ClaudeHeaderSnapshot | null => {
  const quota = (file as Record<string, unknown>).quota;
  if (!quota || typeof quota !== 'object') return null;
  const { signals, observed_at: observedRaw } = quota as { signals?: unknown; observed_at?: unknown };
  if (!signals || typeof signals !== 'object') return null;
  const byName = new Map(
    Object.entries(signals as Record<string, unknown>).map(([name, value]) => [name.toLowerCase(), value])
  );
  const readNumber = (name: string): number | null => {
    const value = byName.get(name);
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };

  const payload: ClaudeUsagePayload = {};
  for (const { key, prefix, periodMs } of CLAUDE_HEADER_WINDOWS) {
    const utilization = readNumber(`${prefix}utilization`);
    if (utilization === null) continue;
    let usedPercent = Math.min(100, Math.max(0, utilization * 100));
    const resetSeconds = readNumber(`${prefix}reset`);
    let resetMs = resetSeconds !== null && resetSeconds > 0 ? resetSeconds * 1000 : null;
    if (resetMs !== null && resetMs <= nowMs) {
      usedPercent = 0;
      resetMs += (Math.floor((nowMs - resetMs) / periodMs) + 1) * periodMs;
    }
    payload[key] = {
      utilization: usedPercent,
      resets_at: resetMs !== null ? new Date(resetMs).toISOString() : null,
    };
  }
  if (!payload.five_hour && !payload.seven_day) return null;

  const observedMs = typeof observedRaw === 'string' ? Date.parse(observedRaw) : NaN;
  return { payload, observedAt: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : '' };
};

const claudeQuotaFromHeaders = (snapshot: ClaudeHeaderSnapshot, t: TFunction): ClaudeQuotaData => ({
  windows: buildClaudeQuotaWindows(snapshot.payload, t),
  extraUsage: null,
  dollarWindows: [],
  observedAt: snapshot.observedAt,
  planType: null,
  source: 'headers',
});

export const hasClaudeUsageData = (quota?: ClaudeQuotaState): boolean =>
  Boolean(
    quota?.observedAt || quota?.windows?.length || quota?.extraUsage || quota?.dollarWindows?.length
  );

const findFableUsageLimit = (payload: ClaudeUsagePayload) => {
  if (!Array.isArray(payload.limits)) return null;

  const candidates = payload.limits.filter((limit) => {
    const kind = (normalizeStringValue(limit?.kind) ?? '').trim().toLowerCase();
    const modelName = (normalizeStringValue(limit?.scope?.model?.display_name) ?? '')
      .trim()
      .toLowerCase();
    const isFable = modelName === 'fable' || modelName === 'fable 5';
    return kind === 'weekly_scoped' && isFable && normalizeNumberValue(limit?.percent) !== null;
  });

  return candidates.find((limit) => limit.is_active === true) ?? candidates[0] ?? null;
};

const isDollarDenominatedWindow = (window: ClaudeUsageWindow) =>
  normalizeNumberValue(window.limit_dollars) !== null ||
  normalizeNumberValue(window.used_dollars) !== null ||
  normalizeNumberValue(window.remaining_dollars) !== null;

export const buildClaudeQuotaWindows = (
  payload: ClaudeUsagePayload,
  t: TFunction
): ClaudeQuotaWindow[] => {
  const windows: ClaudeQuotaWindow[] = [];
  const fableLimit = findFableUsageLimit(payload);

  for (const { key, id, labelKey } of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = payload[key as keyof ClaudeUsagePayload];
    if (!window || typeof window !== 'object' || !('utilization' in window)) continue;
    const typedWindow = window as ClaudeUsageWindow;
    const isCreditPool = key === 'iguana_necktie' && isDollarDenominatedWindow(typedWindow);
    if (key === 'iguana_necktie' && fableLimit && !isCreditPool) continue;
    if (isCreditPool) {
      windows.push({
        id: 'cloud-session-credits',
        label: t('claude_quota.cloud_session_credits'),
        labelKey: 'claude_quota.cloud_session_credits',
        usedPercent: normalizeNumberValue(typedWindow.utilization),
        resetLabel: formatQuotaResetTime(typedWindow.resets_at ?? undefined),
        resetAtMs: resolveResetMs([typedWindow.resets_at]),
        periodHours: null,
      });
      continue;
    }
    const usedPercent = normalizeNumberValue(typedWindow.utilization);
    const resetLabel = formatQuotaResetTime(typedWindow.resets_at ?? undefined);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel,
      // Claude states the period nowhere in the payload, so it comes from the
      // key: `five_hour` is the rolling window, everything else is weekly.
      resetAtMs: resolveResetMs([typedWindow.resets_at]),
      periodHours: claudePeriodHours(key),
    });
  }

  if (fableLimit) {
    const usedPercent = normalizeNumberValue(fableLimit.percent);
    if (usedPercent !== null) {
      windows.push({
        id: 'seven-day-fable',
        label: t('claude_quota.seven_day_fable'),
        labelKey: 'claude_quota.seven_day_fable',
        usedPercent,
        resetLabel: formatQuotaResetTime(fableLimit.resets_at ?? undefined),
        // `weekly_scoped` is a 7-day window by definition, so the timeline can
        // place this row alongside the ones derived from the named keys.
        resetAtMs: resolveResetMs([fableLimit.resets_at]),
        periodHours: claudePeriodHours('seven_day'),
      });
    }
  }

  return windows;
};

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

/**
 * The organization's rate-limit tier is the only field that separates Max 5x
 * from Max 20x (`default_claude_max_5x` / `default_claude_max_20x`); the account
 * flags only say "Max". Pro reports `default_claude_ai`, which Team/Free share,
 * so it is not used to identify Pro.
 */
const resolveClaudeMaxTier = (profile: ClaudeProfileResponse): string | null => {
  const organization = profile.organization as
    (NonNullable<ClaudeProfileResponse['organization']> & { rateLimitTier?: string }) | undefined;
  const tier = normalizeStringValue(
    organization?.rate_limit_tier ?? organization?.rateLimitTier
  )?.toLowerCase();
  if (!tier) return null;
  if (tier.endsWith('claude_max_20x')) return 'plan_max20';
  if (tier.endsWith('claude_max_5x')) return 'plan_max5';
  return null;
};

export const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const organizationType = normalizeStringValue(
    profile.organization?.organization_type
  )?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(
    profile.organization?.subscription_status
  )?.toLowerCase();

  if (organizationType === 'claude_team' && subscriptionStatus === 'active') {
    return 'plan_team';
  }

  // Account flags include personal subscriptions even for a Team-scoped token.
  // A Team-scoped token carries the Team organization's tier, so a personal
  // Max seen through it stays the undifferentiated 'plan_max'.
  const maxTier = resolveClaudeMaxTier(profile);
  if (maxTier) return maxTier;

  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';

  return null;
};

/**
 * Long-lived setup tokens (`claude setup-token`) are inference-only and cannot call the
 * usage, profile or reset endpoints. CPA flags them as `setup_token` in the credential list.
 */
export const isClaudeSetupTokenFile = (file: AuthFileItem): boolean =>
  file['setup_token'] === true || file['setupToken'] === true;

/**
 * Live usage from the usage API; when that fails, fall back to the proxy's snapshot of the
 * latest response's rate-limit headers. Setup tokens skip the usage API entirely.
 */
const fetchClaudeQuota = async (file: AuthFileItem, t: TFunction): Promise<ClaudeQuotaData> => {
  if (isClaudeSetupTokenFile(file)) {
    const snapshot = readClaudeHeaderSnapshot(await latestAuthFile(file)) ?? readClaudeHeaderSnapshot(file);
    if (!snapshot) throw new Error(t('claude_quota.no_header_data'));
    return claudeQuotaFromHeaders(snapshot, t);
  }
  try {
    return await fetchLiveClaudeQuota(file, t);
  } catch (err) {
    const snapshot = readClaudeHeaderSnapshot(await latestAuthFile(file)) ?? readClaudeHeaderSnapshot(file);
    if (snapshot) return claudeQuotaFromHeaders(snapshot, t);
    throw err;
  }
};

/** The credential as CPA reports it now, so the header snapshot is the newest one. */
const latestAuthFile = async (file: AuthFileItem): Promise<AuthFileItem> => {
  try {
    const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex) ?? undefined;
    const { files } = await authFilesApi.list({ name: file.name, authIndex });
    return files.find((entry) => entry.name === file.name) ?? file;
  } catch {
    return file;
  }
};

const fetchLiveClaudeQuota = async (file: AuthFileItem, t: TFunction): Promise<ClaudeQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('claude_quota.missing_auth_index'));
  }

  const [usageResult, profileResult] = await Promise.allSettled([
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS, Accept: 'application/json' },
    }),
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
  ]);

  if (usageResult.status === 'rejected') {
    throw usageResult.reason;
  }

  const result = usageResult.value;

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseClaudeUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('claude_quota.empty_windows'));
  }

  const snapshot = normalizeClaudeUsageSnapshot(payload);
  if (!snapshot) {
    throw new Error(t('claude_quota.empty_windows'));
  }
  const dollarWindows = snapshot.dollarWindows;
  // Full dollar balances get their own amount/reset rows, not a second plan meter.
  const windows = buildClaudeQuotaWindows(payload, t).filter(
    (window) =>
      window.id !== 'cloud-session-credits' ||
      !dollarWindows.some((balance) => balance.key === 'iguana_necktie')
  );
  const planType =
    profileResult.status === 'fulfilled' &&
    profileResult.value.statusCode >= 200 &&
    profileResult.value.statusCode < 300
      ? resolveClaudePlanType(
          parseClaudeProfilePayload(profileResult.value.body ?? profileResult.value.bodyText)
        )
      : null;

  return {
    windows,
    extraUsage: snapshot.extraUsage,
    dollarWindows,
    observedAt: new Date().toISOString(),
    planType,
    source: 'live',
  };
};

export const CLAUDE_CONFIG: QuotaProviderData<ClaudeQuotaState, ClaudeQuotaData> = {
  type: 'claude',
  i18nPrefix: 'claude_quota',
  filterFn: (file) => isClaudeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchClaudeQuota,
  storeSelector: (state) => state.claudeQuota,
  storeSetter: 'setClaudeQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    extraUsage: data.extraUsage,
    planType: data.planType,
    dollarWindows: data.dollarWindows,
    observedAt: data.observedAt,
    source: data.source,
    stale: false,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
};

/**
 * What a Claude card shows before any request: the credential's header snapshot from the
 * credential list, or null when the proxy has not seen a response for it yet.
 */
export const claudeHeaderQuotaState = (
  file: AuthFileItem,
  t: TFunction,
  nowMs: number = Date.now()
): ClaudeQuotaState | null => {
  const snapshot = readClaudeHeaderSnapshot(file, nowMs);
  return snapshot ? CLAUDE_CONFIG.buildSuccessState(claudeQuotaFromHeaders(snapshot, t)) : null;
};

const observedMs = (state: ClaudeQuotaState): number => {
  const parsed = state.observedAt ? Date.parse(state.observedAt) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The Claude usage a card should show: the newer of the stored reading (a live check or an
 * earlier header read) and the current header snapshot. Null only when neither has data.
 */
export const pickLatestClaudeState = (
  stored: ClaudeQuotaState | undefined,
  header: ClaudeQuotaState | null
): ClaudeQuotaState | null => {
  const storedWithData = stored && hasClaudeUsageData(stored) ? stored : null;
  if (storedWithData && header) {
    return observedMs(storedWithData) >= observedMs(header) ? storedWithData : header;
  }
  return storedWithData ?? header;
};
