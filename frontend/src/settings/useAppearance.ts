import { useAuth } from '@/auth/AuthProvider';
import { useI18n } from '@/i18n/I18nProvider';
import type { Locale } from '@/i18n/messages';
import { useTheme, type Theme } from '@/theme/ThemeProvider';
import { useRef, useState } from 'react';

export function useAppearance() {
  const { state, updateProfile } = useAuth();
  const { theme, resolved, setTheme } = useTheme();
  const { locale, setLocale } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);

  async function save(kind: 'theme' | 'language', value: Theme | Locale) {
    if (busy.current) return;
    const previousTheme = theme;
    const previousLocale = locale;
    const apply = () => kind === 'theme' ? setTheme(value as Theme) : setLocale(value as Locale);
    setError(false);
    if (state.status !== 'authed') { apply(); return; }
    busy.current = true;
    setPending(true);
    apply();
    try {
      await updateProfile(kind === 'theme' ? { theme: value as Theme } : { language: value as Locale });
    } catch {
      if (kind === 'theme') setTheme(previousTheme);
      else setLocale(previousLocale);
      setError(true);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return { theme, resolved, locale, pending, error,
    changeTheme: (value: Theme) => save('theme', value),
    changeLocale: (value: Locale) => save('language', value) };
}
