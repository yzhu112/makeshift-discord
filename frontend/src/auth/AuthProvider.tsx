import type { User } from '@/api';
import { ApiError, api } from '@/api';
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
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<AuthState>({ status: 'loading' });

	const channel = useRef<BroadcastChannel | null>(null);
	const revision = useRef(0);
	const mutations = useRef(0);

	const clearAuth = useCallback(() => {
		// In-flight /me responses must not restore a logged-out session.
		revision.current++;
		setState({ status: 'unauthed' });
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
	};

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
	return ctx;
}
