import { OrionProvider, Card, PrimaryButton, Result, Spin, Typography, Form, Input } from '@primathonos/orion';
import { useState, useEffect } from 'react';
import { useIframeAuth } from '@/hooks/useIframeAuth';
import { api, ApiException } from '@/lib/api';
import { installPostMessageListener, readSession } from '@/lib/session';
import { useMerchantStore } from '@/stores/useMerchantStore';
import './index.css';

const RP_ADMIN_URL = (import.meta.env.VITE_RP_ADMIN_URL as string | undefined) ?? '';

function centered(children: React.ReactNode) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
      {children}
    </div>
  );
}

function RegisterScreen() {
  const [loading, setLoading] = useState(false);
  const [domainLoading, setDomainLoading] = useState(true);
  const [registered, setRegistered] = useState(false);
  const [merchantDomain, setMerchantDomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<{ store_domain: string; admin_email: string; admin_password: string; confirm_password: string }>();

  useEffect(() => {
    api<{ domain: string; registered: boolean }>('GET', '/api/admin/merchants/me')
      .then((me) => {
        setMerchantDomain(me.domain);
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

  async function handleRegister(values: { store_domain: string; admin_email: string; admin_password: string }) {
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
      setError(err instanceof ApiException ? err.message : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (registered) {
    const rpUrl = merchantDomain
      ? `${RP_ADMIN_URL}/user/login?store=${merchantDomain}`
      : RP_ADMIN_URL;
    const sdkUrl = (import.meta.env.VITE_SDK_URL as string | undefined) ?? '/sdk/rp-portal.js';
    const scriptSnippet = [
      `<!-- Add this to your storefront layout -->`,
      `<script type="module" src="${sdkUrl}"></script>`,
      ``,
      `<!-- Place this where you want the portal to appear (e.g. /apps/return_prime page) -->`,
      `<rp-return-portal`,
      `  store="${merchantDomain ?? ''}"`,
      `  api-url="${(import.meta.env.VITE_RP_PUBLIC_URL as string | undefined) ?? ''}"`,
      `></rp-return-portal>`,
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
        <div style={{ marginTop: 24 }}>
          <Typography.Text strong>Storefront SDK snippet</Typography.Text>
          <pre style={{
            background: '#f5f5f5',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            padding: '12px 16px',
            marginTop: 8,
            fontSize: 12,
            overflowX: 'auto',
            whiteSpace: 'pre',
            userSelect: 'all',
          }}>
            {scriptSnippet}
          </pre>
        </div>
      </div>
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
              { pattern: /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, message: 'Enter a valid domain (e.g. your-store.gokwik.co)' },
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
    </div>
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
      />
    );
  }

  if (!sessionChecked) return centered(<Spin size="large" />);

  if (!token) {
    return centered(
      <Result
        status="403"
        title="No merchant session"
        subTitle="Open this admin from your Ratio dashboard — a merchant context is required."
      />
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
