import { QuotaErrorMessage } from '@/features/quota/components/QuotaErrorMessage';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
} from '@/stores';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { isRuntimeOnlyAuthFile, type QuotaProviderType } from '@/features/authFiles/constants';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { bindQuotaClasses } from '@/features/quota/types';
import {
  QUOTA_ADAPTERS,
  type QuotaAdapter,
  type QuotaCardState,
} from '@/features/quota/providers';
import {
  claudeHeaderQuotaState,
  pickLatestClaudeState,
} from '@/features/quota/providers/claude/data';
import styles from './AuthFileQuota.module.scss';

/** Bind the auth-file host's compact styles to the quota rendering contract. */
const compactQuotaClasses = bindQuotaClasses(styles, 'AuthFileQuota.module.scss');

const assertNever = (value: never): never => {
  throw new Error(`Unsupported quota type: ${value}`);
};

type QuotaMapUpdater = (
  updater: (prev: Record<string, QuotaCardState>) => Record<string, QuotaCardState>
) => void;

export type AuthFileQuotaController = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  adapter: QuotaAdapter;
  quota: QuotaCardState | undefined;
  status: QuotaCardState['status'];
  loading: boolean;
  canRefresh: boolean;
  refresh: () => Promise<void>;
  resetting: boolean;
  canReset: boolean;
  reset: () => void;
};

/**
 * Quota state and actions for one auth-file card. The card shows the quota section and
 * puts the refresh button in its own action row, so both share this controller.
 * Returns null when the card has no quota section.
 */
export function useAuthFileQuota(
  file: AuthFileItem,
  quotaType: QuotaProviderType | null,
  disableControls: boolean
): AuthFileQuotaController | null {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuota, setResettingQuota] = useState(false);
  const adapter = quotaType ? QUOTA_ADAPTERS[quotaType] : null;
  const cacheKey = getQuotaCacheKey(file);

  const quota = useQuotaStore((state) => {
    if (quotaType === null) return undefined;
    if (quotaType === 'antigravity')
      return state.antigravityQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'claude') return state.claudeQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'codex') return state.codexQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'devin') return state.devinQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'kimi') return state.kimiQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'copilot') return state.copilotQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'meta') return state.metaQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'plugin') return state.pluginQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'xai') return state.xaiQuota[cacheKey] as QuotaCardState | undefined;
    return assertNever(quotaType);
  });

  const updateQuotaState = useQuotaStore((state) =>
    adapter ? (state[adapter.storeSetter] as unknown as QuotaMapUpdater) : null
  );

  const refresh = useCallback(async () => {
    if (!adapter || !updateQuotaState) return;
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading' || resettingQuota) return;

    const cacheGeneration = captureQuotaCacheGeneration(file.name);

    updateQuotaState((prev) => ({
      ...prev,
      [cacheKey]: adapter.buildLoadingState(),
    }));

    try {
      const data = await adapter.fetchQuota(file, t);
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev) => ({
          ...prev,
          [cacheKey]: adapter.buildSuccessState(data),
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev) => ({
          ...prev,
          [cacheKey]: adapter.buildErrorState(message, status, err),
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      });
    }
  }, [
    adapter,
    cacheKey,
    disableControls,
    file,
    quota?.status,
    resettingQuota,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const reset = useCallback(() => {
    if (!adapter || !updateQuotaState) return;
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;
    if (resettingQuota) return;

    const resetQuota = adapter.resetQuota;
    if (!resetQuota) return;

    showConfirmation({
      title: t('codex_quota.reset_confirm_title'),
      message: t('codex_quota.reset_confirm_message', { name: file.name }),
      confirmText: t('codex_quota.reset_confirm_button'),
      variant: 'primary',
      onConfirm: async () => {
        const cacheGeneration = captureQuotaCacheGeneration(file.name);
        setResettingQuota(true);
        try {
          const data = await resetQuota(file, t);
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            updateQuotaState((prev) => ({
              ...prev,
              [cacheKey]: adapter.buildSuccessState(data),
            }));
            showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            showNotification(t('codex_quota.reset_failed', { name: file.name, message }), 'error');
          });
        } finally {
          setResettingQuota(false);
        }
      },
    });
  }, [
    adapter,
    cacheKey,
    disableControls,
    file,
    quota?.status,
    resettingQuota,
    showConfirmation,
    showNotification,
    t,
    updateQuotaState,
  ]);

  if (!quotaType || !adapter) return null;
  const status = quota?.status ?? 'idle';
  const canRefresh = !disableControls && !file.disabled && !resettingQuota;
  return {
    file,
    quotaType,
    adapter,
    quota,
    status,
    loading: status === 'loading',
    canRefresh,
    refresh,
    resetting: resettingQuota,
    canReset: quota !== undefined && Boolean(adapter.resetQuota && adapter.canResetQuota?.(quota)),
    reset,
  };
}

export type AuthFileQuotaSectionProps = {
  controller: AuthFileQuotaController;
};

export function AuthFileQuotaSection({ controller }: AuthFileQuotaSectionProps) {
  const { t } = useTranslation();
  const { file, quotaType, adapter, quota, status, loading, canRefresh, resetting } = controller;

  // Claude always shows the newest data available: the stored reading or the proxy's
  // response-header snapshot. The click-to-load prompt remains only when there is none.
  const claudeHeaderState = useMemo(
    () => (quotaType === 'claude' ? claudeHeaderQuotaState(file, t) : null),
    [file, quotaType, t]
  );
  const claudeDisplay =
    quotaType === 'claude'
      ? pickLatestClaudeState(quota as ClaudeQuotaState | undefined, claudeHeaderState)
      : null;

  const resetQuotaAction = controller.canReset ? (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={styles.quotaResetCreditButton}
      onClick={() => controller.reset()}
      disabled={!canRefresh || loading}
      loading={resetting}
      title={t('codex_quota.reset_button')}
      aria-label={t('codex_quota.reset_button')}
    >
      {!resetting && <IconRefreshCw size={14} />}
      {t('codex_quota.reset_button')}
    </Button>
  ) : undefined;

  return (
    <div className={styles.quotaSection}>
      {claudeDisplay ? (
        <>
          {loading && <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.loading`)}</div>}
          <adapter.Body quota={claudeDisplay} classes={compactQuotaClasses} />
        </>
      ) : status === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.loading`)}</div>
      ) : status === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => void controller.refresh()}
          disabled={!canRefresh}
        >
          {t(`${adapter.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' && quota ? (
        <div className={styles.quotaError}>
          <QuotaErrorMessage quota={quota} i18nPrefix={adapter.i18nPrefix} />
        </div>
      ) : quota ? (
        <adapter.Body quota={quota} classes={compactQuotaClasses} />
      ) : (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.idle`)}</div>
      )}
      {resetQuotaAction && <div className={styles.quotaCardActions}>{resetQuotaAction}</div>}
    </div>
  );
}
