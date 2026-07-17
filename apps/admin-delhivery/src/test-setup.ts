import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest doesn't auto-run Testing Library cleanup unless `globals: true`; do it
// explicitly so renders from one test don't leak into the next (which would
// otherwise surface as "found multiple elements").
afterEach(() => {
  cleanup();
});
