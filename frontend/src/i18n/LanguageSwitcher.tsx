import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from './I18nProvider';
import { LOCALES, LOCALE_LABELS, type Locale } from './messages';

export function LanguageSwitcher() {
	const { locale, setLocale, t } = useI18n();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					aria-label={t('settings.language')}
					title={t('settings.language')}
					className="gap-1.5"
				>
					<Languages className="h-3.5 w-3.5" />
					<span className="text-xs">{LOCALE_LABELS[locale]}</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="min-w-[9rem]">
				<DropdownMenuLabel>{t('settings.language')}</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={locale}
					onValueChange={(v) => setLocale(v as Locale)}
				>
					{LOCALES.map((l) => (
						<DropdownMenuRadioItem key={l} value={l}>
							{LOCALE_LABELS[l]}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
