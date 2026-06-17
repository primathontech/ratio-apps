import { OrionProvider } from '@primathonos/orion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHashHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

// The app is served from a deep, version-pinned subpath on the Ratio host
// (e.g. /apps/<app>/<install>/<version>/index.html) and runs inside an iframe.
// Browser history would make the router try to match that full pathname against
// our routes ('/', '/config', …), which never matches → "Not Found" on open.
// Hash history keeps the route in the URL fragment (#/, #/config) so the server
// path never changes — the initial load lands on Overview regardless of depth.
const hashHistory = createHashHistory();

const router = createRouter({ routeTree, defaultPreload: 'intent', history: hashHistory });

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
