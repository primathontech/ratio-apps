import {
  Card,
  Form,
  Input,
  OrionProvider,
  PrimaryButton,
  Result,
  Spin,
  Switch,
  Typography,
} from '@primathonos/orion';
import { useEffect, useState } from 'react';
import { useIframeAuth } from '@/hooks/useIframeAuth';
import { ApiException, api } from '@/lib/api';
import { installPostMessageListener, readSession } from '@/lib/session';
import { useMerchantStore } from '@/stores/useMerchantStore';
import './index.css';

const RP_ADMIN_URL = (import.meta.env.VITE_RP_ADMIN_URL as string | undefined) ?? '';

function centered(children: React.ReactNode) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
      }}
    >
      {children}
    </div>
  );
}

// 'choice': "are you new here, or do you already use Return Prime?" landing.
// 'signup': the existing full form — creates a brand-new RP account.
// 'login': merchant_id alone (already GoKwik/Ratio-authenticated) is enough —
//   no email/password needed, just confirms linking to an existing account.
type ScreenMode = 'choice' | 'signup' | 'login';

export function RegisterScreen() {
  const [loading, setLoading] = useState(false);
  const [domainLoading, setDomainLoading] = useState(true);
  const [registered, setRegistered] = useState(false);
  const [alreadyLinked, setAlreadyLinked] = useState(false);
  const [merchantDomain, setMerchantDomain] = useState<string | null>(null);
  // Pre-filled from /me's domain, but editable — login must not silently trust
  // whatever domain ratio-apps has on file (it can be a placeholder equal to the
  // merchant ID itself if Ratio's OAuth response never carried a real one; see
  // rp-auth.controller.ts's callback()). The merchant confirms or corrects it here,
  // same safety net signup's Store Domain field already has.
  const [loginDomain, setLoginDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Set alongside `error` when RP rejects because the merchant picked the wrong
  // mode (already exists / not found) — drives a "Switch to Login/Sign Up"
  // button instead of leaving the merchant stuck on a dead-end error message.
  const [switchTo, setSwitchTo] = useState<'login' | 'signup' | null>(null);
  const [active, setActive] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [screenMode, setScreenMode] = useState<ScreenMode>('choice');
  const [form] = Form.useForm<{
    store_domain: string;
    admin_email: string;
    admin_password: string;
    confirm_password: string;
  }>();

  useEffect(() => {
    api<{
      domain: string;
      registered: boolean;
      active: boolean;
      suggestedMode: 'login' | 'signup' | null;
    }>('GET', '/api/admin/merchants/me')
      .then((me) => {
        setMerchantDomain(me.domain);
        setLoginDomain(me.domain);
        setActive(me.active);
        if (me.registered) {
          setRegistered(true);
        } else {
          form.setFieldsValue({
            store_domain: me.domain,
            admin_email: `admin@${me.domain}`,
          });
          // RP already told us whether this merchant exists there — skip the
          // manual "have you used Return Prime before?" guess. Null (RP
          // unreachable/misconfigured) leaves screenMode at 'choice' as before.
          if (me.suggestedMode) setScreenMode(me.suggestedMode);
        }
      })
      .catch(() => {})
      .finally(() => setDomainLoading(false));
  }, [form]);

  async function handleStatusChange(next: boolean) {
    // Turning this off is a full disconnect, not a reversible pause: it blocks every
    // /rp/shopify/* call and RP dashboard login immediately, AND — if this store was
    // linked to an existing Shopify Return Prime account — restores that account's
    // original plan and removes the OS link (Ratio/OS has no separate "uninstall"
    // signal yet, so this toggle stands in for it). Re-enabling afterward doesn't
    // silently restore a removed link; a dual-platform store would need to register
    // again from this screen. Confirm before doing that — resuming from a simple
    // pause (no prior disconnect) is the safe direction, so it goes straight through.
    if (
      !next &&
      !window.confirm(
        'Disable Return Prime for this OS store? Return/exchange requests will stop working immediately. If this store is linked to an existing Shopify Return Prime account, that link will be removed and its original plan restored — you would need to register again to reconnect.',
      )
    ) {
      return;
    }
    setStatusLoading(true);
    try {
      const res = await api<{ active: boolean }>('POST', '/api/admin/status', { active: next });
      setActive(res.active);
    } catch (err) {
      setError(
        err instanceof ApiException ? err.message : 'Could not update status. Please try again.',
      );
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleRegister(values: {
    store_domain: string;
    admin_email: string;
    admin_password: string;
  }) {
    setLoading(true);
    setError(null);
    setSwitchTo(null);
    try {
      const res = await api<{ domain: string; alreadyLinked?: boolean }>(
        'POST',
        '/api/admin/register',
        {
          store_domain: values.store_domain,
          admin_email: values.admin_email,
          admin_password: values.admin_password,
          mode: 'signup',
        },
      );
      setMerchantDomain(res.domain ?? values.store_domain);
      setAlreadyLinked(Boolean(res.alreadyLinked));
      setRegistered(true);
    } catch (err) {
      if (err instanceof ApiException && err.errorCode === 'RP_MERCHANT_ALREADY_EXISTS') {
        setError(err.message);
        setSwitchTo('login');
      } else {
        setError(
          err instanceof ApiException ? err.message : 'Registration failed. Please try again.',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  // No email/password: the GoKwik/Ratio session already authenticated this
  // merchant_id, which is all RP needs to find and link an existing account.
  async function handleLogin() {
    setLoading(true);
    setError(null);
    setSwitchTo(null);
    try {
      const res = await api<{ domain: string; alreadyLinked?: boolean }>(
        'POST',
        '/api/admin/register',
        {
          mode: 'login',
          store_domain: loginDomain,
        },
      );
      setMerchantDomain(res.domain ?? merchantDomain);
      setAlreadyLinked(Boolean(res.alreadyLinked));
      setRegistered(true);
    } catch (err) {
      if (err instanceof ApiException && err.errorCode === 'RP_MERCHANT_NOT_FOUND') {
        setError(err.message);
        setSwitchTo('signup');
      } else {
        setError(
          err instanceof ApiException ? err.message : 'Onboarding failed. Please try again.',
        );
      }
    } finally {
      setLoading(false);
    }
  }

  if (registered) {
    const rpUrl = merchantDomain
      ? `${RP_ADMIN_URL}/user/login?store=${merchantDomain}`
      : RP_ADMIN_URL;
    const adapterUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
    const sdkSrc = `${adapterUrl}/rp/sdk/rp-portal.js?store=${encodeURIComponent(merchantDomain ?? '')}&redirectTo=/apps/return_prime`;
    const scriptSnippet = [
      `<!-- Add this one script tag to your storefront layout (once, site-wide). -->`,
      `<!-- It auto-detects order pages and your /apps/return_prime page and injects -->`,
      `<!-- everything itself — no other markup needed. -->`,
      `<script type="module" async src="${sdkSrc}"></script>`,
    ].join('\n');

    return centered(
      <div style={{ maxWidth: 600, width: '100%' }}>
        <Result
          status="success"
          title={
            alreadyLinked
              ? 'Connected to your existing Return Prime account'
              : 'Return Prime configured!'
          }
          subTitle={
            alreadyLinked
              ? 'This store already had Return Prime set up on Shopify — we linked to that same account instead of creating a new one, so your existing policies, orders, and return history all carry over.'
              : 'Your store is connected. Copy the snippet below into your storefront, then open the Return Prime dashboard to configure policies.'
          }
          extra={
            RP_ADMIN_URL ? (
              <PrimaryButton onClick={() => window.open(rpUrl, '_blank')}>
                Open Return Prime Dashboard
              </PrimaryButton>
            ) : null
          }
        />
        <Card style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text strong>Return Prime enabled</Typography.Text>
              <div>
                <Typography.Text type="secondary">
                  {active
                    ? 'Return and exchange requests are active for this store.'
                    : 'Disabled — return/exchange requests are blocked, RP dashboard login is disabled, and any linked Shopify account has been disconnected for this store.'}
                </Typography.Text>
              </div>
            </div>
            <Switch checked={active} loading={statusLoading} onChange={handleStatusChange} />
          </div>
        </Card>
        {error && (
          <Typography.Text type="danger" style={{ display: 'block', marginTop: 16 }}>
            {error}
          </Typography.Text>
        )}
        <div style={{ marginTop: 24 }}>
          <Typography.Text strong>Storefront SDK snippet</Typography.Text>
          <pre
            style={{
              background: '#f5f5f5',
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              padding: '12px 16px',
              marginTop: 8,
              fontSize: 12,
              overflowX: 'auto',
              whiteSpace: 'pre',
              userSelect: 'all',
            }}
          >
            {scriptSnippet}
          </pre>
        </div>
      </div>,
    );
  }

  if (domainLoading) return centered(<Spin size="large" />);

  function errorBlock() {
    if (!error) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <Typography.Text type="danger" style={{ display: 'block' }}>
          {error}
        </Typography.Text>
        {switchTo && (
          <PrimaryButton
            style={{ marginTop: 8 }}
            onClick={() => {
              setError(null);
              setSwitchTo(null);
              setScreenMode(switchTo);
            }}
          >
            {switchTo === 'login' ? 'Switch to Onboard OS store' : 'Switch to Sign Up'}
          </PrimaryButton>
        )}
      </div>
    );
  }

  if (screenMode === 'choice') {
    return centered(
      <div className="container">
        <Card title="Connect Return Prime">
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
            Have you used Return Prime with this business before (e.g. on Shopify)?
          </Typography.Text>
          {errorBlock()}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <PrimaryButton onClick={() => setScreenMode('login')} style={{ width: '100%' }}>
              Yes — Onboard OS store to my existing account
            </PrimaryButton>
            <PrimaryButton onClick={() => setScreenMode('signup')} style={{ width: '100%' }}>
              No — Sign Up for the first time
            </PrimaryButton>
          </div>
        </Card>
      </div>,
    );
  }

  if (screenMode === 'login') {
    return centered(
      <div className="container">
        <Card title="Onboard OS store to Return Prime">
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
            We'll link this store to your existing Return Prime account — no password needed.
            Confirm the OpenStore domain below.
          </Typography.Text>
          {errorBlock()}
          <Form.Item label="Store Domain" style={{ marginBottom: 16 }}>
            <Input
              value={loginDomain}
              onChange={(e) => setLoginDomain(e.target.value)}
              placeholder="your-store.gokwik.co"
            />
          </Form.Item>
          <PrimaryButton
            loading={loading}
            disabled={!loginDomain.trim()}
            onClick={handleLogin}
            style={{ width: '100%' }}
          >
            Onboard OS store to Return Prime
          </PrimaryButton>
          <Typography.Text
            type="secondary"
            style={{ display: 'block', marginTop: 12, cursor: 'pointer' }}
            onClick={() => {
              setError(null);
              setSwitchTo(null);
              setScreenMode('choice');
            }}
          >
            ← Back
          </Typography.Text>
        </Card>
      </div>,
    );
  }

  return centered(
    <div className="container">
      <Card title="Connect Return Prime">
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
          Create your Return Prime admin account to start managing returns.
        </Typography.Text>
        {errorBlock()}
        <Form form={form} layout="vertical" onFinish={handleRegister}>
          <Form.Item
            name="store_domain"
            label="Store Domain"
            rules={[
              { required: true, message: 'Store domain is required' },
              {
                pattern: /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
                message: 'Enter a valid domain (e.g. your-store.gokwik.co)',
              },
            ]}
          >
            <Input
              placeholder="your-store.gokwik.co"
              onChange={(e) => {
                const domain = e.target.value.trim();
                if (domain) {
                  form.setFieldValue('admin_email', `admin@${domain}`);
                }
              }}
            />
          </Form.Item>
          <Form.Item
            name="admin_email"
            label="Admin Email"
            rules={[
              { required: true, message: 'Email is required' },
              { type: 'email', message: 'Enter a valid email' },
            ]}
          >
            <Input placeholder="admin@your-store.com" />
          </Form.Item>
          <Form.Item
            name="admin_password"
            label="Password"
            rules={[
              { required: true, message: 'Password is required' },
              { min: 8, message: 'Minimum 8 characters' },
            ]}
          >
            <Input.Password placeholder="Password" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="Confirm Password"
            dependencies={['admin_password']}
            rules={[
              { required: true, message: 'Please confirm your password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('admin_password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="Confirm password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <PrimaryButton htmlType="submit" loading={loading} style={{ width: '100%' }}>
              Register in Return Prime
            </PrimaryButton>
          </Form.Item>
        </Form>
        <Typography.Text
          type="secondary"
          style={{ display: 'block', marginTop: 12, cursor: 'pointer' }}
          onClick={() => {
            setError(null);
            setSwitchTo(null);
            setScreenMode('choice');
          }}
        >
          ← Back
        </Typography.Text>
      </Card>
    </div>,
  );
}

export function App() {
  const { isAuthorized, parentOrigin } = useIframeAuth();
  const token = useMerchantStore((s) => s.token);
  const setToken = useMerchantStore((s) => s.setToken);
  const [sessionChecked, setSessionChecked] = useState(false);

  useEffect(() => {
    setToken(readSession());
    setSessionChecked(true);
    return installPostMessageListener((id) => setToken(id));
  }, [setToken]);

  if (isAuthorized === null) return centered(<Spin size="large" />);

  if (!isAuthorized) {
    return centered(
      <Result
        status="403"
        title="Access restricted"
        subTitle={
          parentOrigin
            ? `This app can only be opened from the Ratio dashboard. Detected parent: ${parentOrigin}`
            : 'This app can only be opened from the Ratio dashboard.'
        }
      />,
    );
  }

  if (!sessionChecked) return centered(<Spin size="large" />);

  if (!token) {
    return centered(
      <Result
        status="403"
        title="No merchant session"
        subTitle="Open this admin from your Ratio dashboard — a merchant context is required."
      />,
    );
  }

  return <RegisterScreen />;
}

export function Root() {
  return (
    <OrionProvider>
      <App />
    </OrionProvider>
  );
}
