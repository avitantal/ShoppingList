import { useCallback, useRef } from 'react';
import type { PointerEvent } from 'react';

interface Options {
  /** ms to hold before the long-press fires. */
  delay?: number;
  /** Pixels the pointer can drift before the press is cancelled. Default 8. */
  moveThreshold?: number;
}

interface Handlers {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onPointerCancel: (e: PointerEvent) => void;
  onPointerLeave: (e: PointerEvent) => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
}

// Fires `onLongPress` after the pointer is held still for `delay` ms.
// Co-exists with react-swipeable on the same element: if the pointer
// moves more than `moveThreshold` pixels in any direction before the
// timer fires, the press is cancelled (so a horizontal swipe doesn't
// accidentally trigger a long-press).

export function useLongPress(onLongPress: (() => void) | null, options: Options = {}): Handlers {
  const { delay = 550, moveThreshold = 8 } = options;
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    startRef.current = null;
  }, [clearTimer]);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (!onLongPress) return;
      // Only react to primary button on mouse; touch and pen don't have buttons.
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      firedRef.current = false;
      startRef.current = { x: e.clientX, y: e.clientY };
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        firedRef.current = true;
        onLongPress();
      }, delay);
    },
    [onLongPress, delay, clearTimer],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!startRef.current) return;
      const dx = Math.abs(e.clientX - startRef.current.x);
      const dy = Math.abs(e.clientY - startRef.current.y);
      if (dx > moveThreshold || dy > moveThreshold) cancel();
    },
    [moveThreshold, cancel],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // Suppress the native long-press menu on touch devices so our handler wins.
    onContextMenu: (e) => {
      if (firedRef.current) e.preventDefault();
    },
  };
}
