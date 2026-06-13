import type { FormEvent } from 'react';
import { useState } from 'react';
import { ApiError } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { SettingsBar } from '@/components/SettingsBar';
import { Button } from '@/components/ui/button';
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/i18n/I18nProvider';

type Mode = 'login' | 'signup';

export function AuthGate() {
	const [mode, setMode] = useState<Mode>('login');
	const t = useT();

	return (
		<div className="flex min-h-svh flex-col bg-background sm:items-center sm:justify-center sm:px-4 sm:py-12">
			<SettingsBar floating />
			<Card className="flex w-full flex-1 flex-col gap-0 overflow-hidden rounded-none py-0 shadow-none ring-0 sm:max-w-sm sm:flex-none sm:rounded-xl sm:shadow-sm sm:ring-1">
				<CardHeader className="space-y-3 border-b bg-muted/40 px-6 pb-7 pt-[max(env(safe-area-inset-top),1.75rem)] text-center sm:py-7">
					<p className="text-[10px] font-medium tracking-[0.22em] text-muted-foreground uppercase">
						{t('auth.brand')}
					</p>
					<div className="flex justify-center pt-1">
						<CardTitle className="flex size-20 items-center justify-center rounded-full bg-primary font-heading text-2xl font-normal italic text-primary-foreground shadow-sm">
							DC.
						</CardTitle>
					</div>
					<CardDescription className="text-sm">
						{mode === 'login'
							? t('auth.welcome.login')
							: t('auth.welcome.signup')}
					</CardDescription>
				</CardHeader>

				<CardContent className="flex-1 px-6 pt-6 pb-2 sm:flex-none">
					{mode === 'login' ? <LoginForm /> : <SignupForm />}
				</CardContent>

				<CardFooter className="justify-center px-6 pt-2 pb-[max(env(safe-area-inset-bottom),1.5rem)] sm:pb-6">
					<button
						type="button"
						onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
						className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
					>
						{mode === 'login'
							? t('auth.switch.toSignup')
							: t('auth.switch.toLogin')}
					</button>
				</CardFooter>
			</Card>
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
		<form onSubmit={onSubmit} className="space-y-5">
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
				className="h-12 w-full text-sm sm:h-10"
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
		<form onSubmit={onSubmit} className="space-y-5">
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
				className="h-12 w-full text-sm sm:h-10"
				disabled={submitting}
			>
				{submitting ? t('auth.action.signup.loading') : t('auth.action.signup')}
			</Button>
		</form>
	);
}
