import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Shim `jest` global so @testing-library/react's asyncWrapper detects vitest's
// fake timers (it calls `jest.advanceTimersByTime(0)` to drain the microtask
// queue after waitFor). Without this, `waitFor` hangs when used with
// `vi.useFakeTimers()` because asyncWrapper awaits a setTimeout(0) that
// never fires under fake timers.
// Reference: node_modules/@testing-library/react/dist/pure.js (asyncWrapper)
// and node_modules/@testing-library/dom/dist/helpers.js (jestFakeTimersAreEnabled)
if (typeof (globalThis as unknown as { jest?: unknown }).jest === 'undefined') {
  (globalThis as unknown as { jest: unknown }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  };
}
