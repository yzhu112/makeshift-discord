import { isPlainNavigation, useNavigation } from '@/navigation';
import { useActiveCall } from '@/room/ActiveCallProvider';
import type { CallAudioSettings } from '@/audio/AudioSettings';
import { useT } from '@/i18n/I18nProvider';
import { AudioLines } from 'lucide-react';
import type { ReactNode } from 'react';
import { ProfileMenu } from './ProfileMenu';
import { SettingsBar } from './SettingsBar';

export function AppHeader({ section, username, audio, children, brandHref = '/', showLanguage = true }: {
  section: string;
  brandHref?: string;
  showLanguage?: boolean;
  username?: string;
  audio?: CallAudioSettings;
  children?: ReactNode;
}) {
  const t = useT();
  const navigation = useNavigation();
  const call = useActiveCall();
  const settings = audio ?? call?.audioSettings;
  const brand = <>
    <AudioLines size={22} strokeWidth={1.7} aria-hidden="true" />
    <strong>{t('ui.brand')}</strong>
  </>;
  return (
    <header className="app-header">
      <div className="app-brand">
        {brandHref
          ? <a href={brandHref} className="app-brand-name" onClick={event => {
            if (navigation && brandHref === '/' && isPlainNavigation(event)) {
              event.preventDefault();
              navigation.navigate('lobby');
            }
          }}>{brand}</a>
          : <span className="app-brand-name">{brand}</span>}
        <span className="app-breadcrumb" aria-hidden="true">/</span>
        <span className="app-section-name">{section}</span>
      </div>
      <div className="app-header-actions">
        {children}
        <SettingsBar audio={settings} showAudio={!username} showLanguage={showLanguage} />
        {username && <ProfileMenu username={username} audio={settings} />}
      </div>
    </header>
  );
}
