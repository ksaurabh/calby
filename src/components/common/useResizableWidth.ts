import { useCallback, useRef, useState } from 'react';

function readStored(key: string, fallback: number, min: number, max: number): number {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(value)));
  } catch {
    // Storage may be blocked; the width just won't be remembered.
  }
}

/**
 * A panel width the user can drag, remembered per browser under `storageKey`.
 * Pass the returned `handleProps` to a <ResizeHandle>.
 */
export function useResizableWidth(storageKey: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => readStored(storageKey, initial, min, max));
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const clamp = useCallback((w: number) => Math.min(max, Math.max(min, w)), [min, max]);

  const commit = useCallback((w: number) => {
    const next = clamp(w);
    setWidth(next);
    store(storageKey, next);
  }, [clamp, storageKey]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(clamp(drag.current.startWidth + e.clientX - drag.current.startX));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    commit(width);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === 'ArrowLeft') { e.preventDefault(); commit(width - step); }
    if (e.key === 'ArrowRight') { e.preventDefault(); commit(width + step); }
  };

  return {
    width,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
      // Double-click puts it back to the default width.
      onDoubleClick: () => commit(initial),
      'aria-valuenow': Math.round(width),
      'aria-valuemin': min,
      'aria-valuemax': max,
    },
  };
}

export type ResizeHandleProps = ReturnType<typeof useResizableWidth>['handleProps'];
