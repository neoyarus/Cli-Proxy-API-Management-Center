import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { ManualCooldownRequest } from '@/services/api/authFiles';
import type { AuthFileItem } from '@/types';
import { cooldownChoices, cooldownRequest } from '../cooldownChoices';
import styles from './AuthFileCooldownDialog.module.scss';

export type AuthFileCooldownDialogProps = {
  open: boolean;
  file: AuthFileItem;
  busy: boolean;
  onConfirm: (pause: ManualCooldownRequest) => void;
  onClose: () => void;
};

export function AuthFileCooldownDialog({ open, file, busy, onConfirm, onClose }: AuthFileCooldownDialogProps) {
  const { t, i18n } = useTranslation();
  const name = useId();
  // Recomputed when the dialog opens so the offered end times start from now.
  const choices = useMemo(() => (open ? cooldownChoices(file) : []), [file, open]);
  const [selectedId, setSelectedId] = useState<string>('hours-1');
  const selected = choices.find((choice) => choice.id === selectedId) ?? choices[0];
  const formatTime = (ms: number) =>
    new Date(ms).toLocaleString(i18n.resolvedLanguage, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <Modal
      open={open}
      title={t('auth_files.manual_cooldown_title', { name: file.note || file.name })}
      onClose={onClose}
      closeDisabled={busy}
      width={420}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!selected}
            onClick={() => selected && onConfirm(cooldownRequest(selected))}
          >
            {t('auth_files.manual_cooldown_confirm')}
          </Button>
        </div>
      }
    >
      <fieldset className={styles.choices}>
        {choices.map((choice) => (
          <label key={choice.id} className={styles.choice}>
            <input
              type="radio"
              name={name}
              value={choice.id}
              checked={selected?.id === choice.id}
              onChange={() => setSelectedId(choice.id)}
            />
            <span>{t(choice.labelKey, choice.labelOptions)}</span>
            <span className={styles.when}>{formatTime(choice.untilMs)}</span>
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}
