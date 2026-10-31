import { SettingsDialog } from '@/settings/SettingsDialog';
import { UserAvatar } from './UserAvatar';
import { isPlainNavigation, useNavigation } from '@/navigation';
import { type CallAudioSettings } from '@/audio/AudioSettings';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n/I18nProvider';
import { Activity, LogOut, Settings } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function ProfileMenu({ username, audio }: { username: string; audio?: CallAudioSettings }) {
  const { logout, state, avatar } = useAuth();
  const name = state.status === 'authed' ? state.user.display_name || username : username;
  const t = useT();
  const navigation = useNavigation();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openingSettings = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function signOut() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setFailed(false);
    try {
      await logout();
    } catch {
      setFailed(true);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button ref={triggerRef} type="button" className="app-account" aria-label={t('profile.open', { name })} title={name}>
          <UserAvatar name={name} avatar={avatar} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60 max-w-[calc(100vw-24px)] rounded-md animate-none!" onCloseAutoFocus={event => {
        // Let the dialog take focus when opening it from a menu item.
        if (openingSettings.current) {
          event.preventDefault();
          openingSettings.current = false;
        }
      }}>
        <DropdownMenuLabel className="px-3 pt-2 pb-1 tracking-normal normal-case">{t('profile.signedIn')}</DropdownMenuLabel>
        <p className="px-3 pb-2 text-sm font-medium break-words">{username}</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => {
          openingSettings.current = true;
          setSettingsOpen(true);
        }} className="min-h-9 px-3 text-xs">
          <Settings size={14} aria-hidden="true" />{t('account.settings')}
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="min-h-9 px-3 text-xs">
          <a href="/diagnostics" onClick={event => {
            if (navigation && isPlainNavigation(event)) {
              event.preventDefault();
              navigation.navigate('diagnostics');
            }
          }}>
            <Activity size={14} aria-hidden="true" />
            <span>{t('profile.diagnostics')}</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onSelect={event => { event.preventDefault(); void signOut(); }} className="min-h-9 px-3 text-xs">
          <LogOut size={14} />{t(pending ? 'profile.loggingOut' : 'lobby.logout')}
        </DropdownMenuItem>
        {failed && <p role="alert" className="px-3 py-2 text-xs leading-relaxed text-destructive">{t('profile.logoutError')}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
    <SettingsDialog audio={audio} open={settingsOpen} onOpenChange={setSettingsOpen} returnFocusRef={triggerRef} />
    </>
  );
}
