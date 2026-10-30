import { AudioSettings, type CallAudioSettings } from '@/audio/AudioSettings';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/theme/ThemeToggle';

type Props = {
	floating?: boolean;
	audio?: CallAudioSettings;
	className?: string;
};

export function SettingsBar({ floating = false, className, audio }: Props) {
	return (
			<div
				className={cn(
					'flex items-center gap-0.5',
					floating &&
						'fixed top-3 right-3 z-40 rounded-full border bg-card/70 px-1 py-0.5 shadow-sm backdrop-blur',
					className,
				)}
			>
				<LanguageSwitcher />
				<ThemeToggle />
				<AudioSettings call={audio} />
			</div>
	);
}
