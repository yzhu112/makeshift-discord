import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/i18n/I18nProvider';
import { type Theme, useTheme } from './ThemeProvider';

export function ThemeToggle() {
	const { theme, resolved, setTheme } = useTheme();
	const t = useT();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t('settings.theme')}
					title={t('settings.theme')}
				>
					{resolved === 'dark' ? (
						<Moon className="h-3.5 w-3.5" />
					) : (
						<Sun className="h-3.5 w-3.5" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="min-w-[9rem]">
				<DropdownMenuLabel>{t('settings.theme')}</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={theme}
					onValueChange={(v) => setTheme(v as Theme)}
				>
					<DropdownMenuRadioItem value="light">
						<Sun className="h-3.5 w-3.5" />
						{t('settings.theme.light')}
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="dark">
						<Moon className="h-3.5 w-3.5" />
						{t('settings.theme.dark')}
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="system">
						<Monitor className="h-3.5 w-3.5" />
						{t('settings.theme.system')}
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
