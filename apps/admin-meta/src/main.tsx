import { OrionProvider } from '@primathonos/orion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, Navigate, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  // When the dashboard opens the app at any path that isn't a known route,
  // land on Overview ("/") instead of a bare "Not Found" screen.
  defaultNotFoundComponent: () => <Navigate to="/" replace />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

createRoot(root).render(
  <StrictMode>
    <OrionProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </OrionProvider>
  </StrictMode>,
);
