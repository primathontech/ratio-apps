import { Layout, Result, Spin } from '@primathonos/orion';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { useIframeAuth } from '@/hooks/useIframeAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { ApiException } from '@/lib/api';
import { installPostMessageListener, readSession } from '@/lib/session';
import { useMerchantStore } from '@/stores/useMerchantStore';

const ERROR_MERCHANT_NOT_FOUND = 'MERCHANT_NOT_FOUND';

export const Route = createRootRoute({ component: RootLayout });

function CenteredScreen({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <Layout
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(muted ? { background: '#fafafa' } : {}),
      }}
    >
      {children}
    </Layout>
  );
}

function StatusScreen({ title, subTitle }: { title: string; subTitle: ReactNode }) {
  return (
    <CenteredScreen muted>
      <Result status="403" title={title} subTitle={subTitle} />
    </CenteredScreen>
  );
}

function LoadingScreen() {
  return (
    <CenteredScreen>
      <Spin size="large" />
    </CenteredScreen>
  );
}

function RootLayout() {
  const { isAuthorized, parentOrigin } = useIframeAuth();
  const token = useMerchantStore((s) => s.token);
  const setToken = useMerchantStore((s) => s.setToken);
  const [sessionChecked, setSessionChecked] = useState(false);
  const merchant = useMerchant();

  useEffect(() => {
    setToken(readSession());
    setSessionChecked(true);
    return installPostMessageListener((id) => setToken(id));
  }, [setToken]);

  // Iframe-embed gate. Admin must be loaded inside a gokwik.co / gokwik.in
  // parent (or running on localhost in dev). Anything else gets a Forbidden
  // screen — no API calls, no UI.
  if (isAuthorized === null) return <LoadingScreen />;

  if (!isAuthorized) {
    return (
      <StatusScreen
        title="Access restricted"
        subTitle={
          parentOrigin
            ? `This app can only be opened from the Ratio dashboard. Detected parent: ${parentOrigin}`
            : 'This app can only be opened from the Ratio dashboard.'
        }
      />
    );
  }

  if (!sessionChecked) return <LoadingScreen />;

  if (!token) {
    return (
      <StatusScreen
        title="No merchant session"
        subTitle="Open this admin from your Ratio dashboard. A merchant context is required to load this page."
      />
    );
  }

  if (merchant.isLoading) return <LoadingScreen />;

  if (merchant.isError) {
    const code = merchant.error instanceof ApiException ? merchant.error.errorCode : undefined;
    const subTitle =
      code === ERROR_MERCHANT_NOT_FOUND
        ? 'This merchant id is not installed. Reopen the admin from your Ratio dashboard with a valid session.'
        : 'Unable to validate this merchant. Please try again.';
    return <StatusScreen title="Invalid merchant" subTitle={subTitle} />;
  }

  if (merchant.data && !merchant.data.isActive) {
    return (
      <StatusScreen
        title="Invalid merchant"
        subTitle="This merchant has uninstalled the app. Reinstall from the Ratio marketplace to restore access."
      />
    );
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#fafafa' }}>
      <Navbar />
      <Layout.Content>
        <div className="container">
          <Outlet />
        </div>
      </Layout.Content>
    </Layout>
  );
}
