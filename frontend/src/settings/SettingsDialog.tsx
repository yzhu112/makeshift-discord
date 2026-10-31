import { AudioSettingsBody, type CallAudioSettings } from '@/audio/AudioSettings';
import { useAuth } from '@/auth/AuthProvider';
import { UserAvatar } from '@/components/UserAvatar';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useT } from '@/i18n/I18nProvider';
import { LOCALES, LOCALE_LABELS } from '@/i18n/messages';
import { Headphones, Monitor, Moon, Palette, Sun, UserRound } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { useRef, useState, type RefObject } from 'react';
import { AvatarEditor } from './AvatarEditor';
import { nameLength } from './profile';
import { useAppearance } from './useAppearance';
import './settings.css';

export function SettingsDialog({ open, onOpenChange, audio, returnFocusRef }: {
  open: boolean; onOpenChange: (open: boolean) => void; audio?: CallAudioSettings;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent animated={false} closeLabel={t('account.close')} className="account-settings" onCloseAutoFocus={event => {
      if (returnFocusRef.current) { event.preventDefault(); returnFocusRef.current.focus(); }
    }}>
      <DialogTitle className="sr-only">{t('account.settings')}</DialogTitle>
      <DialogDescription className="sr-only">{t('account.description')}</DialogDescription>
      {open && <SettingsBody audio={audio} />}
    </DialogContent>
  </Dialog>;
}

function SettingsBody({ audio }: { audio?: CallAudioSettings }) {
  const t = useT();
  const { state, avatar } = useAuth();
  if (state.status !== 'authed') return null;
  const user = state.user;
  const name = user.display_name || user.username;
  return <Tabs.Root defaultValue="profile" orientation="vertical" className="settings-layout">
    <aside className="settings-sidebar">
      <div className="settings-identity"><UserAvatar name={name} avatar={avatar} /><div><strong>{name}</strong><span>@{user.username}</span></div></div>
      <Tabs.List className="settings-navigation" aria-label={t('account.settings')}>
        <Tabs.Trigger value="profile"><UserRound size={16} aria-hidden="true" /><span>{t('account.profile')}</span></Tabs.Trigger>
        <Tabs.Trigger value="appearance"><Palette size={16} aria-hidden="true" /><span>{t('account.appearance')}</span></Tabs.Trigger>
        <Tabs.Trigger value="audio"><Headphones size={16} aria-hidden="true" /><span>{t('account.audio')}</span></Tabs.Trigger>
      </Tabs.List>
    </aside>
    <div className="settings-content">
      <Tabs.Content value="profile" forceMount className="settings-panel"><ProfilePanel key={user.id} /></Tabs.Content>
      <Tabs.Content value="appearance" className="settings-panel"><AppearancePanel /></Tabs.Content>
      <Tabs.Content value="audio" className="settings-panel settings-audio"><div className="audio-settings"><AudioSettingsBody call={audio} embedded /></div></Tabs.Content>
    </div>
  </Tabs.Root>;
}

function ProfilePanel() {
  const t = useT();
  const { state, updateProfile } = useAuth();
  const user = state.status === 'authed' ? state.user : undefined;
  const [draft, setDraft] = useState(user?.display_name ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  if (!user) return null;
  const length = nameLength(draft);
  const changed = (draft.trim() || null) !== (user.display_name ?? null);
  async function save() {
    if (busy.current || !changed || length > 32) return;
    busy.current = true; setPending(true); setError(false); setSaved(false);
    try { await updateProfile({ display_name: draft.trim() || null }); setDraft(draft.trim()); setSaved(true); }
    catch { setError(true); }
    finally { busy.current = false; setPending(false); }
  }
  return <>
    <header className="settings-heading"><h2>{t('account.profile')}</h2><p>{t('account.profileHelp')}</p></header>
    <section className="settings-section" aria-labelledby="display-name-label">
      <label id="display-name-label" htmlFor="display-name">{t('account.displayName')}</label>
      <p className="settings-help" id="display-name-help">{t('account.nameHelp', { username: user.username })}</p>
      <div className="settings-name-input"><input id="display-name" value={draft} placeholder={user.username} autoComplete="nickname"
        aria-describedby="display-name-help display-name-count" aria-invalid={length > 32} disabled={pending}
        onChange={event => { setDraft(event.target.value); setSaved(false); setError(false); }}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); } }} />
        <span id="display-name-count" className={length > 32 ? 'error' : ''}>{t('account.nameCount', { count: length })}</span>
      </div>
      <div className="settings-actions">
        <button type="button" className="settings-button primary" disabled={!changed || length > 32 || pending} onClick={() => void save()}>{t(pending ? 'account.saving' : 'account.saveName')}</button>
        {draft && <button type="button" className="settings-text-button" disabled={pending} onClick={() => { setDraft(''); setSaved(false); }}>{t('account.clearName')}</button>}
        <span role={error ? 'alert' : 'status'} className={`settings-feedback ${error ? 'error' : saved ? 'success' : ''}`}>{error ? t('account.saveError') : saved ? t('account.saved') : length > 32 ? t('account.nameTooLong') : ''}</span>
      </div>
    </section>
    <AvatarEditor name={user.display_name || user.username} />
  </>;
}

function AppearancePanel() {
  const t = useT();
  const { theme, locale, pending, error, changeTheme, changeLocale } = useAppearance();
  return <>
    <header className="settings-heading"><h2>{t('account.appearance')}</h2><p>{t('account.appearanceHelp')}</p></header>
    <section className="settings-section"><h3 id="account-theme-label">{t('settings.theme')}</h3>
      <div className="settings-themes" role="group" aria-labelledby="account-theme-label">
        {([{ value: 'light', Icon: Sun }, { value: 'dark', Icon: Moon }, { value: 'system', Icon: Monitor }] as const).map(({ value, Icon }) =>
          <button key={value} type="button" className="settings-theme" aria-pressed={theme === value} disabled={pending} onClick={() => void changeTheme(value)}>
            <span className={`theme-swatch ${value}`} aria-hidden="true"><i /><span><i /><i /></span></span>
            <span><Icon size={14} aria-hidden="true" />{t(`settings.theme.${value}`)}</span>
          </button>)}
      </div>
    </section>
    <section className="settings-section"><h3 id="account-language-label">{t('settings.language')}</h3>
      <div className="settings-languages" role="group" aria-labelledby="account-language-label">
        {LOCALES.map(value => <button key={value} type="button" className="settings-button" lang={value} aria-pressed={locale === value} disabled={pending} onClick={() => void changeLocale(value)}>{LOCALE_LABELS[value]}</button>)}
      </div>
    </section>
    <p role={error ? 'alert' : 'status'} className={`settings-feedback ${error ? 'error' : ''}`}>{error ? t('account.saveError') : pending ? t('account.saving') : ''}</p>
  </>;
}
