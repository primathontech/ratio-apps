import { OrionProvider } from '@primathonos/orion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock the hooks the route depends on so we can render in isolation.
vi.mock('@/hooks/useConfig', () => ({
  useConfig: () => ({ data: undefined, isLoading: false }),
  useUpdateConfig: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, error: null }),
}));

import { ConfigPage as Component } from './-config-page';

describe('config route', () => {
  it('renders the App ID input, data-centre select, swPath input', () => {
    const qc = new QueryClient();
    render(
      <OrionProvider>
        <QueryClientProvider client={qc}>
          <Component />
        </QueryClientProvider>
      </OrionProvider>,
    );
    expect(screen.getByText('App ID')).toBeInTheDocument();
    expect(screen.getByText('Data centre')).toBeInTheDocument();
    expect(screen.getByText(/Service worker path/)).toBeInTheDocument();
  });
});
