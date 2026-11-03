import { useState } from 'react';

/** Open/collapsed, remembered in this browser under `key` (best-effort). */
export function useCollapsed(key: string, initiallyCollapsed = false): [boolean, () => void] {
  const storageKey = `calby.collapsed.${key}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored == null ? initiallyCollapsed : stored === '1';
    } catch {
      return initiallyCollapsed;
    }
  });
  const toggle = () =>
    setCollapsed(c => {
      try {
        localStorage.setItem(storageKey, c ? '0' : '1');
      } catch {
        // Not remembered, but still toggled.
      }
      return !c;
    });
  return [collapsed, toggle];
}
