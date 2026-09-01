import { useEffect, useState } from 'react';

const NAVIGATE_EVENT = 'calby:navigate';

/** Push a new path and let every listener know, without a full reload. */
export function navigate(path: string) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** The current pathname, re-read on back/forward and on navigate(). */
export function usePathname(): string {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);

  return pathname;
}
