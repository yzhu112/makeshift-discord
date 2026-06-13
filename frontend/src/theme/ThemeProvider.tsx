import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

type ThemeContextValue = {
	theme: Theme;
	resolved: 'light' | 'dark';
	setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'makeshift.theme';

function readStored(): Theme {
	if (typeof window === 'undefined') return 'system';
	const raw = window.localStorage.getItem(STORAGE_KEY);
	return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

function systemPrefersDark(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia('(prefers-color-scheme: dark)').matches
	);
}

function apply(resolved: 'light' | 'dark') {
	const root = document.documentElement;
	root.classList.toggle('dark', resolved === 'dark');
	root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(() => readStored());
	const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
		readStored() === 'dark' ||
		(readStored() === 'system' && systemPrefersDark())
			? 'dark'
			: 'light',
	);

	useEffect(() => {
		const next = theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme;
		setResolved(next);
		apply(next);
	}, [theme]);

	useEffect(() => {
		if (theme !== 'system') return;
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => {
			const next = mq.matches ? 'dark' : 'light';
			setResolved(next);
			apply(next);
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, [theme]);

	const setTheme = (t: Theme) => {
		window.localStorage.setItem(STORAGE_KEY, t);
		setThemeState(t);
	};

	return (
		<ThemeContext.Provider value={{ theme, resolved, setTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme() {
	const ctx = useContext(ThemeContext);
	if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
	return ctx;
}
