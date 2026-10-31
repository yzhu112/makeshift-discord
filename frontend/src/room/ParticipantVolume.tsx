import { useI18n } from '@/i18n/I18nProvider';
import { Volume2, VolumeX } from 'lucide-react';
import { useId } from 'react';

export function ParticipantVolume({ identity, volume, onChange }: {
  identity: string;
  volume: number;
  onChange: (volume: number) => void;
}) {
  const { t, locale } = useI18n();
  const id = useId();
  const percentage = new Intl.NumberFormat(locale, { style: 'percent' }).format(volume / 100);
  return (
    <div className="participant-volume">
      <label htmlFor={id} title={t('room.volume.for', { name: identity })}>
        {volume === 0 ? <VolumeX size={14} strokeWidth={1.5} aria-hidden="true" /> : <Volume2 size={14} strokeWidth={1.5} aria-hidden="true" />}
        <span className="sr-only">{t('room.volume.for', { name: identity })}</span>
      </label>
      <input id={id} type="range" min="0" max="200" step="1" value={volume}
        aria-label={t('room.volume.for', { name: identity })}
        aria-valuetext={percentage} aria-describedby={`${id}-help`}
        onChange={event => onChange(Number(event.target.value))} />
      <output htmlFor={id} aria-hidden="true">{percentage}</output>
      <span id={`${id}-help`} className="sr-only">{t('room.volume.help')}</span>
    </div>
  );
}
