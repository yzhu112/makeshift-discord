import type { ReactNode } from 'react';
import { AudioLines } from 'lucide-react';
import type { CallAudioSettings } from '@/audio/AudioSettings';
import { SettingsBar } from './SettingsBar';
import { DiagnosticsLink } from '@/diagnostics/DiagnosticsLink';
import { useT } from '@/i18n/I18nProvider';

export function AppHeader({ section, username, audio, children }: {
  section: string;
  username?: string;
  audio?: CallAudioSettings;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="app-header">
      <div className="app-brand">
        <AudioLines size={22} strokeWidth={1.7} aria-hidden="true" />
        <strong>{t('ui.brand')}</strong>
        <span className="app-breadcrumb" aria-hidden="true">/</span>
        <span className="app-section-name">{section}</span>
      </div>
      <div className="app-header-actions">
        {children}
        {username && <DiagnosticsLink />}
        <SettingsBar audio={audio} />
        {username && <span className="app-account" title={username}>{username.slice(0, 1).toUpperCase()}</span>}
      </div>
    </header>
  );
}
