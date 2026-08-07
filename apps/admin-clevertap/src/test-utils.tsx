import { OrionProvider } from '@primathonos/orion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type RenderResult, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

export function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <OrionProvider>
      <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>
    </OrionProvider>
  );
}

export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: Providers });
}
