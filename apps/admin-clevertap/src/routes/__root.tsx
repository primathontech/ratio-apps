import { Alert, Layout, Result, Spin } from '@primathonos/orion';
import { createRootRoute, Navigate, Outlet, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { useConfig } from '@/hooks/useConfig';
import { useIframeAuth } from '@/hooks/useIframeAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { ApiException } from '@/lib/api';
import { DISABLED_ROUTE, resolveMerchantGate } from '@/lib/merchant-gate';
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

export function RootLayout() {
  const { isAuthorized, parentOrigin } = useIframeAuth();
  const token = useMerchantStore((s) => s.token);
  const setToken = useMerchantStore((s) => s.setToken);
  const [sessionChecked, setSessionChecked] = useState(false);
  const merchant = useMerchant();
  const { location } = useRouterState();

  useEffect(() => {
    setToken(readSession());
    setSessionChecked(true);
    return installPostMessageListener((id) => setToken(id));
  }, [setToken]);

  const errorCode = merchant.error instanceof ApiException ? merchant.error.errorCode : undefined;

  const gate = resolveMerchantGate({
    isAuthorized,
    parentOrigin,
    sessionChecked,
    token,
    merchant: {
      isLoading: merchant.isLoading,
      isError: merchant.isError,
      errorCode,
      isActive: merchant.data?.isActive,
      hasData: !!merchant.data,
    },
  });

  if (gate.kind === 'checking') return <LoadingScreen />;

  if (gate.kind === 'embed-blocked') {
    return (
      <StatusScreen
        title="Access restricted"
        subTitle={
          gate.parentOrigin
            ? `This app can only be opened from the Ratio dashboard. Detected parent: ${gate.parentOrigin}`
            : 'This app can only be opened from the Ratio dashboard.'
        }
      />
    );
  }

  if (gate.kind === 'no-session') {
    return (
      <StatusScreen
        title="No merchant session"
        subTitle="Open this admin from your Ratio dashboard. A merchant context is required to load this page."
      />
    );
  }

  if (gate.kind === 'invalid') {
    return (
      <StatusScreen
        title="Invalid merchant"
        subTitle={
          gate.errorCode === ERROR_MERCHANT_NOT_FOUND
            ? 'This merchant id is not installed. Reopen the admin from your Ratio dashboard with a valid session.'
            : 'Unable to validate this merchant. Please try again.'
        }
      />
    );
  }

  if (gate.kind === 'disabled') {
    if (location.pathname !== DISABLED_ROUTE) {
      return <Navigate to={DISABLED_ROUTE} replace />;
    }
    return <Outlet />;
  }

  if (location.pathname === DISABLED_ROUTE) {
    return <Navigate to="/" replace />;
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#fafafa' }}>
      <Navbar />
      <Layout.Content>
        <div className="container">
          <KillSwitchBanner />
          <Outlet />
        </div>
      </Layout.Content>
    </Layout>
  );
}

function KillSwitchBanner() {
  const { data } = useConfig();
  if (!data || data.clevertapEnabled !== false) return null;
  return (
    <Alert
      type="warning"
      showIcon
      closable
      style={{ marginBottom: 16 }}
      message="CleverTap is turned off for this merchant (rollout paused). Settings remain editable."
    />
  );
}
