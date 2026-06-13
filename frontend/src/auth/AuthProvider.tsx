import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '../api';
import { api } from '../api';

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

	useEffect(() => {
		api<User>('/api/me')
			.then((user) => setState({ status: 'authed', user }))
			.catch(() => setState({ status: 'unauthed' }));
	}, []);

	const value: AuthContextValue = {
		state,
		signup: async (input) => {
			await api('/api/signup', {
				method: 'POST',
				body: JSON.stringify(input),
			});
			// Re-fetch /me so we get the full user incl. the room signup auto-joined.
			const user = await api<User>('/api/me');
			setState({ status: 'authed', user });
		},
		login: async (input) => {
			await api('/api/login', {
				method: 'POST',
				body: JSON.stringify(input),
			});
			const user = await api<User>('/api/me');
			setState({ status: 'authed', user });
		},
		logout: async () => {
			await api<{ ok: true }>('/api/logout', { method: 'POST' });
			setState({ status: 'unauthed' });
		},
		refresh: async () => {
			const user = await api<User>('/api/me');
			setState({ status: 'authed', user });
		},
	};

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
	return ctx;
}
