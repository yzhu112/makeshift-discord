import { I18nProvider } from '@/i18n/I18nProvider';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './workspace.css';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<ThemeProvider>
			<I18nProvider>
				<App />
			</I18nProvider>
		</ThemeProvider>
	</StrictMode>,
);
