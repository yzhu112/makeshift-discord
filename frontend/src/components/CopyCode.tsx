import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useT } from '@/i18n/I18nProvider';
import { cn } from '@/lib/utils';

type Props = {
	code: string;
	className?: string;
};

/** Click-to-copy room code: mono, letter-spaced, with copied feedback. */
export function CopyCode({ code, className }: Props) {
	const t = useT();
	const [copied, setCopied] = useState(false);

	async function copy(e: React.MouseEvent) {
		e.stopPropagation();
		await navigator.clipboard.writeText(code);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}

	return (
		<button
			type="button"
			onClick={copy}
			aria-label={t('lobby.copyCode')}
			title={t('lobby.copyCode')}
			className={cn(
				'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-xs tracking-[0.2em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
				className,
			)}
		>
			<span>{code}</span>
			{copied ? (
				<Check className="h-3 w-3 text-primary" />
			) : (
				<Copy className="h-3 w-3" />
			)}
		</button>
	);
}
