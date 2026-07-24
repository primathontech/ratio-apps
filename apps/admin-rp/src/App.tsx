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

export function RegisterScreen() {
  const [loading, setLoading] = useState(false);
  const [domainLoading, setDomainLoading] = useState(true);
  const [registered, setRegistered] = useState(false);
  const [merchantDomain, setMerchantDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const [form] = Form.useForm<{
    store_domain: string;
    admin_email: string;
    admin_password: string;
    confirm_password: string;
  }>();

  useEffect(() => {
    api<{ domain: string; registered: boolean; active: boolean }>('GET', '/api/admin/merchants/me')
      .then((me) => {
        setMerchantDomain(me.domain);
        setActive(me.active);
        if (me.registered) {
          setRegistered(true);
        } else {
          form.setFieldsValue({
            store_domain: me.domain,
            admin_email: `admin@${me.domain}`,
          });
        }
      })
      .catch(() => {})
      .finally(() => setDomainLoading(false));
  }, [form]);

  async function handleStatusChange(next: boolean) {
    // Pausing blocks every /rp/shopify/* call for this store and locks the merchant out
    // of the RP dashboard (same as a real Shopify uninstall) — confirm before doing that,
    // resuming is the safe direction so it goes straight through.
    if (!next && !window.confirm('Pause Return Prime for this store? Return/exchange requests will stop working until you turn it back on.')) {
      return;
    }
    setStatusLoading(true);
    try {
      const res = await api<{ active: boolean }>('POST', '/api/admin/status', { active: next });
      setActive(res.active);
    } catch (err) {
      setError(err instanceof ApiException ? err.message : 'Could not update status. Please try again.');
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
    try {
      const res = await api<{ domain: string }>('POST', '/api/admin/register', {
        store_domain: values.store_domain,
        admin_email: values.admin_email,
        admin_password: values.admin_password,
      });
      setMerchantDomain(res.domain ?? values.store_domain);
      setRegistered(true);
    } catch (err) {
      setError(
        err instanceof ApiException ? err.message : 'Registration failed. Please try again.',
      );
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
          title="Return Prime configured!"
          subTitle="Your store is connected. Copy the snippet below into your storefront, then open the Return Prime dashboard to configure policies."
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
                    : 'Paused — return/exchange requests are blocked and the RP dashboard login is disabled for this store.'}
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

  return centered(
    <div className="container">
      <Card title="Connect Return Prime">
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
          Create your Return Prime admin account to start managing returns.
        </Typography.Text>
        {error && (
          <Typography.Text type="danger" style={{ display: 'block', marginBottom: 16 }}>
            {error}
          </Typography.Text>
        )}
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
