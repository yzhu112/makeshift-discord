import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { LOCALES, MESSAGES, type Locale, type MessageKey } from './messages';

type I18nContextValue = {
	locale: Locale;
	setLocale: (l: Locale) => void;
	t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);
const STORAGE_KEY = 'makeshift.locale';

function detectInitial(): Locale {
	if (typeof window === 'undefined') return 'en';
	const stored = window.localStorage.getItem(STORAGE_KEY);
	if (stored && (LOCALES as readonly string[]).includes(stored)) {
		return stored as Locale;
	}
	const nav = window.navigator.language?.toLowerCase() ?? '';
	if (nav.startsWith('zh')) return 'zh';
	if (nav.startsWith('ja')) return 'ja';
	return 'en';
}

function interpolate(
	template: string,
	vars?: Record<string, string | number>,
): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (_, k) =>
		k in vars ? String(vars[k]) : `{${k}}`,
	);
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(() => detectInitial());

	useEffect(() => {
		document.documentElement.lang = locale;
	}, [locale]);

	const value = useMemo<I18nContextValue>(
		() => ({
			locale,
			setLocale: (l) => {
				window.localStorage.setItem(STORAGE_KEY, l);
				setLocaleState(l);
			},
			t: (key, vars) => interpolate(MESSAGES[locale][key], vars),
		}),
		[locale],
	);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
	const ctx = useContext(I18nContext);
	if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
	return ctx;
}

export function useT() {
	return useI18n().t;
}
