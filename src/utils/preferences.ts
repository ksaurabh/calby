import { useSyncExternalStore } from 'react';

// Per-browser display preferences, kept in localStorage.
export type LinkFont = 'sans' | 'mono';

const KEY = 'prefs.linkFont';
const listeners = new Set<() => void>();

function read(): LinkFont {
  try {
    return localStorage.getItem(KEY) === 'mono' ? 'mono' : 'sans';
  } catch {
    return 'sans';
  }
}

export function setLinkFont(font: LinkFont) {
  try {
    localStorage.setItem(KEY, font);
  } catch {
    // Storage blocked: the choice lasts only until reload.
  }
  current = font;
  listeners.forEach(l => l());
}

let current = read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The font for booking links, and the Tailwind class that applies it. */
export function useLinkFont() {
  const font = useSyncExternalStore(subscribe, () => current);
  return { font, className: font === 'mono' ? 'font-mono' : 'font-sans' };
}
