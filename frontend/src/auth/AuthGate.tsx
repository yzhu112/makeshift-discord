import type { FormEvent } from 'react';
import { useState } from 'react';
import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { AppHeader } from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/i18n/I18nProvider';

type Mode = 'login' | 'signup';

export function AuthGate() {
	const [mode, setMode] = useState<Mode>('login');
	const t = useT();

	return (
    <div className="workspace auth-page">
      <AppHeader section={t('ui.account')} />
      <main className="auth-main">
        <div className="auth-intro">
          <p className="app-eyebrow">{t('ui.voiceWorkspace')}</p>
          <h1>{t(mode === 'login' ? 'auth.action.login' : 'auth.action.signup')}</h1>
          <p>{t(mode === 'login' ? 'auth.welcome.login' : 'auth.welcome.signup')}</p>
        </div>
        <section className="auth-panel" aria-label={t(mode === 'login' ? 'auth.action.login' : 'auth.action.signup')}>
          {mode === 'login' ? <LoginForm /> : <SignupForm />}
          <div className="auth-switch">
            <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
              {t(mode === 'login' ? 'auth.switch.toSignup' : 'auth.switch.toLogin')}
            </button>
          </div>
        </section>
        <p className="auth-caption">{t('ui.authCaption')}</p>
      </main>
    </div>
  );
}

function LoginForm() {
	const { login } = useAuth();
	const t = useT();
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await login({ username, password });
		} catch (err) {
			setError(err instanceof ApiError ? err.message : t('auth.error.login'));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form onSubmit={onSubmit} className="app-form">
			<div className="space-y-2">
				<Label htmlFor="login-username">{t('auth.field.username')}</Label>
				<Input
					id="login-username"
					className="max-sm:h-12"
					value={username}
					onChange={(e) => setUsername(e.target.value)}
					autoComplete="username"
					required
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="login-password">{t('auth.field.password')}</Label>
				<Input
					id="login-password"
					type="password"
					className="max-sm:h-12"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					autoComplete="current-password"
					required
				/>
			</div>
			{error && (
				<p role="alert" className="text-xs text-destructive" aria-live="polite">
					{error}
				</p>
			)}
			<Button
				type="submit"
				className="app-button app-button-primary w-full"
				disabled={submitting}
			>
				{submitting ? t('auth.action.login.loading') : t('auth.action.login')}
			</Button>
		</form>
	);
}

function SignupForm() {
	const { signup } = useAuth();
	const t = useT();
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [inviteCode, setInviteCode] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setSubmitting(true);
		try {
			await signup({ username, password, inviteCode });
		} catch (err) {
			setError(err instanceof ApiError ? err.message : t('auth.error.signup'));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form onSubmit={onSubmit} className="app-form">
			<div className="space-y-2">
				<Label htmlFor="signup-username">{t('auth.field.username')}</Label>
				<Input
					id="signup-username"
					className="max-sm:h-12"
					value={username}
					onChange={(e) => setUsername(e.target.value)}
					autoComplete="username"
					required
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="signup-password">{t('auth.field.password')}</Label>
				<Input
					id="signup-password"
					type="password"
					className="max-sm:h-12"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					autoComplete="new-password"
					required
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor="signup-invite">{t('auth.field.invite')}</Label>
				<Input
					id="signup-invite"
					className="max-sm:h-12"
					value={inviteCode}
					onChange={(e) => setInviteCode(e.target.value)}
					autoComplete="off"
					required
				/>
			</div>
			{error && (
				<p role="alert" className="text-xs text-destructive" aria-live="polite">
					{error}
				</p>
			)}
			<Button
				type="submit"
				className="app-button app-button-primary w-full"
				disabled={submitting}
			>
				{submitting ? t('auth.action.signup.loading') : t('auth.action.signup')}
			</Button>
		</form>
	);
}
