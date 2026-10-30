import { useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n/I18nProvider';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function ProfileMenu({ username }: { username: string }) {
  const { logout } = useAuth();
  const t = useT();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="app-account" aria-label={t('profile.open', { name: username })} title={username}>
          {username.slice(0, 1).toUpperCase()}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60 max-w-[calc(100vw-24px)] rounded-md animate-none!">
        <DropdownMenuLabel className="px-3 pt-2 pb-1 tracking-normal normal-case">{t('profile.signedIn')}</DropdownMenuLabel>
        <p className="px-3 pb-2 text-sm font-medium break-words">{username}</p>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onSelect={event => { event.preventDefault(); void signOut(); }} className="min-h-9 px-3 text-xs">
          <LogOut size={14} />{t(pending ? 'profile.loggingOut' : 'lobby.logout')}
        </DropdownMenuItem>
        {failed && <p role="alert" className="px-3 py-2 text-xs leading-relaxed text-destructive">{t('profile.logoutError')}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
