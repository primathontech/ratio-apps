import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest doesn't auto-run Testing Library cleanup unless `globals: true`; do it
// explicitly so mounted trees from one test don't leak into the next.
afterEach(() => {
  cleanup();
});
