import type { ProfileUpdate, User } from '@/api';
import { ApiError, api } from '@/api';
import { useI18n } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type AuthState =
	| { status: 'loading' }
	| { status: 'unauthed' }
	| { status: 'authed'; user: User };

export type SignupInput = {
	username: string;
	password: string;
	inviteCode: string;
};
export type LoginInput = { username: string; password: string };

type AuthContextValue = {
	state: AuthState;
	signup: (input: SignupInput) => Promise<void>;
	login: (input: LoginInput) => Promise<void>;
	logout: () => Promise<void>;
	refresh: () => Promise<void>;
	updateProfile: (changes: ProfileUpdate) => Promise<void>;
	avatar: string | null | undefined;
	avatarError: boolean;
	retryAvatar: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<AuthState>({ status: 'loading' });
	const stateRef = useRef(state);
	stateRef.current = state;
	const [avatarCache, setAvatarCache] = useState<{ id: number; version: number | null; data: string | null }>();
	const [avatarError, setAvatarError] = useState(false);
	const [avatarAttempt, setAvatarAttempt] = useState(0);
	const updateQueue = useRef(Promise.resolve());
	const { setTheme } = useTheme();
	const { setLocale } = useI18n();
	const user = state.status === 'authed' ? state.user : undefined;
	const userId = user?.id;
	const userVersion = user?.updated_at;
	const avatarCurrent = avatarCache?.id === userId && avatarCache?.version === userVersion;

	useEffect(() => {
		if (user?.theme) setTheme(user.theme);
		if (user?.language) setLocale(user.language);
		// NULL leaves the existing browser preference in place.
	}, [userId, user?.theme, user?.language]);

	useEffect(() => {
		if (userId === undefined || avatarCurrent) return;
		const controller = new AbortController();
		setAvatarError(false);
		void api<User & { avatar: string | null }>('/api/me?include=avatar', { signal: controller.signal })
			.then(result => {
				if (!controller.signal.aborted && result.id === userId && result.updated_at === userVersion) {
					setAvatarCache({ id: result.id, version: result.updated_at, data: result.avatar ?? null });
				}
			})
			.catch(() => { if (!controller.signal.aborted) setAvatarError(true); });
		return () => controller.abort();
	}, [userId, userVersion, avatarCurrent, avatarAttempt]);

	const channel = useRef<BroadcastChannel | null>(null);
	const revision = useRef(0);
	const mutations = useRef(0);

	const clearAuth = useCallback(() => {
		// In-flight /me responses must not restore a logged-out session.
		revision.current++;
		setState({ status: 'unauthed' });
		setAvatarCache(undefined);
		setAvatarError(false);
	}, []);

	const loadUser = useCallback(async () => {
		const request = ++revision.current;
		try {
			const user = await api<User>('/api/me');
			if (request === revision.current) setState({ status: 'authed', user });
		} catch (error) {
			if (request === revision.current) {
				if (error instanceof ApiError && error.status === 401) clearAuth();
				else setState(previous => previous.status === 'loading' ? { status: 'unauthed' } : previous);
			}
			throw error;
		}
	}, [clearAuth]);

	useEffect(() => {
		// BroadcastChannel is optional; session checks also cover missed events.
		let connection: BroadcastChannel | null = null;
		try {
			connection = new BroadcastChannel('voice-auth');
			connection.onmessage = event => {
				if (event.data?.type === 'logout') clearAuth();
			};
			channel.current = connection;
		} catch { /* Unavailable in some browser contexts. */ }

		const recheck = () => {
			if (document.visibilityState === 'visible' && mutations.current === 0) {
				void loadUser().catch(() => {});
			}
		};
		void loadUser().catch(() => {});
		window.addEventListener('focus', recheck);
		window.addEventListener('pageshow', recheck);
		document.addEventListener('visibilitychange', recheck);
		return () => {
			revision.current++;
			window.removeEventListener('focus', recheck);
			window.removeEventListener('pageshow', recheck);
			document.removeEventListener('visibilitychange', recheck);
			channel.current = null;
			connection?.close();
		};
	}, [clearAuth, loadUser]);

	async function authenticate(path: string, input: LoginInput | SignupInput) {
		const request = ++revision.current;
		mutations.current++;
		try {
			await api(path, { method: 'POST', body: JSON.stringify(input) });
			if (request === revision.current) await loadUser();
		} finally {
			mutations.current--;
		}
	}

	const updateProfile = useCallback((changes: ProfileUpdate) => {
		const expected = stateRef.current;
		if (expected.status !== 'authed') return Promise.reject(new Error('Unauthenticated'));
		mutations.current++;
		const operation = updateQueue.current.then(async () => {
			const current = stateRef.current;
			if (current.status !== 'authed' || current.user.id !== expected.user.id) throw new Error('Session changed');
			const request = ++revision.current;
			try {
				const updated = await api<User>('/api/me', { method: 'PATCH', body: JSON.stringify(changes) });
				if (revision.current !== request) throw new Error('Session changed');
				setState({ status: 'authed', user: updated });
				setAvatarCache(previous => {
					if (Object.hasOwn(changes, 'avatar')) return { id: updated.id, version: updated.updated_at, data: changes.avatar ?? null };
					return previous?.id === updated.id ? { ...previous, version: updated.updated_at } : previous;
				});
				if (Object.hasOwn(changes, 'avatar')) setAvatarError(false);
			} catch (error) {
				if (error instanceof ApiError && error.status === 401) clearAuth();
				throw error;
			}
		}).finally(() => { mutations.current--; });
		updateQueue.current = operation.catch(() => {});
		return operation;
	}, [clearAuth]);

	const value: AuthContextValue = {
		state,
		signup: input => authenticate('/api/signup', input),
		login: input => authenticate('/api/login', input),
		logout: async () => {
			revision.current++;
			mutations.current++;
			try {
				await api<{ ok: true }>('/api/logout', { method: 'POST' });
				clearAuth();
				// Receivers only clear local state: no extra HTTP requests or broadcasts.
				try { channel.current?.postMessage({ type: 'logout' }); } catch { /* Local logout already succeeded. */ }
			} finally {
				mutations.current--;
			}
		},
		refresh: loadUser,
		updateProfile,
		avatar: avatarCache && avatarCache.id === userId ? avatarCache.data : undefined,
		avatarError,
		retryAvatar: () => setAvatarAttempt(attempt => attempt + 1),
	};

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
	return ctx;
}
