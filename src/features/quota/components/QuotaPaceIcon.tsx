/**
 * Small muted arrow beside a window's reset time: ahead of, on, or under pace.
 */

import { useTranslation } from 'react-i18next';
import { IconMoveRight, IconTrendingDown, IconTrendingUp } from '@/components/ui/icons';
import type { QuotaPace } from '../pace';
import type { QuotaClassMap } from '../types';

const PACE_ICONS = {
  ahead: IconTrendingUp,
  on: IconMoveRight,
  under: IconTrendingDown,
} as const;

export function QuotaPaceIcon({ pace, classes }: { pace: QuotaPace; classes: QuotaClassMap }) {
  const { t } = useTranslation();
  const Icon = PACE_ICONS[pace];
  const label = t(`quota_management.pace_${pace}`);
  return (
    <span
      className={classes.quotaPace}
      role="img"
      aria-label={label}
      title={label}
      data-quota-pace={pace}
    >
      <Icon size={13} />
    </span>
  );
}
