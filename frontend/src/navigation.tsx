import { createContext, useContext } from 'react';
import type { MouseEvent } from 'react';

export type Page = 'lobby' | 'call' | 'diagnostics';
export const NavigationContext = createContext<{
  page: Page;
  navigate: (page: Page) => void;
} | null>(null);
export const useNavigation = () => useContext(NavigationContext);

export function isPlainNavigation(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function pageFromPath(path: string): Page {
  if (path.replace(/\/$/, '') === '/diagnostics') return 'diagnostics';
  if (path.replace(/\/$/, '') === '/call') return 'call';
  return 'lobby';
}
