import {
  Alert,
  Button,
  Card,
  DangerButton,
  Input,
  PrimaryButton,
  Space,
  Spin,
  Typography,
  WarningModal,
} from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMerchant } from '@/hooks/useMerchant';
import {
  useCredentials,
  useGenerateCredentials,
  useRegenerateCredentials,
} from '@/hooks/useUnicommerce';

export const Route = createFileRoute('/')({ component: ConnectPage });

export function ConnectPage() {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id;
  const [ucUsername, setUcUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);

  const existing = useCredentials(merchantId);
  const generate = useGenerateCredentials();
  const regenerate = useRegenerateCredentials(merchantId);

  function handleGenerate() {
    const trimmed = ucUsername.trim();
    if (!trimmed) return;
    generate.mutate({ merchantId: merchantId ?? '', ucUsername: trimmed });
  }

  function handleConfirmRegenerate() {
    setConfirmRegenerateOpen(false);
    setShowPassword(false);
    regenerate.mutate();
  }

  // Prefer whichever is freshest and already in hand: a just-completed
  // generate/regenerate result (avoids waiting on a refetch round trip),
  // falling back to what's on file from a previous visit.
  const credentials = generate.data ?? regenerate.data ?? existing.data ?? null;
  // Only `existing` (GET /admin/credentials) carries the connection-status
  // proof-of-life timestamp — a fresh generate/regenerate response never has
  // it (nothing could possibly have called in the same instant), so read it
  // from `existing` specifically rather than fighting a union type in JSX.
  const lastInboundCallAt = existing.data?.lastInboundCallAt ?? null;

  if (existing.isLoading) {
    return (
      <Space direction="vertical" size="large" style={{ display: 'flex', alignItems: 'center' }}>
        <Spin size="large" />
      </Space>
    );
  }

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Connect Unicommerce
        </Typography.Title>
        <Typography.Text type="secondary">
          Generate Ratio credentials to paste into your Unicommerce account's "Ratio" channel
          settings.
        </Typography.Text>
      </div>

      <Card title="Ratio channel credentials">
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          {existing.isError && (
            <Alert
              type="error"
              showIcon
              message="Couldn't load existing credentials"
              description={(existing.error as Error).message}
            />
          )}

          {!credentials && (
            <>
              <div>
                <label
                  htmlFor="uc-username"
                  style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
                >
                  Your Unicommerce username
                </label>
                <Input
                  id="uc-username"
                  value={ucUsername}
                  onChange={(e) => setUcUsername(e.target.value)}
                  placeholder="your-uc-login"
                />
              </div>

              <div style={{ textAlign: 'right' }}>
                <PrimaryButton
                  loading={generate.isPending}
                  disabled={!ucUsername.trim()}
                  onClick={handleGenerate}
                >
                  Generate credentials
                </PrimaryButton>
              </div>

              {generate.isError && (
                <Alert type="error" showIcon message={(generate.error as Error).message} />
              )}
            </>
          )}

          {credentials && (
            <>
              <Alert
                type="success"
                showIcon
                message="Ratio channel credentials"
                description={
                  <Space direction="vertical" size={4} style={{ display: 'flex' }}>
                    <Typography.Text>
                      Base URL:{' '}
                      <Typography.Text copyable={{ text: credentials.baseUrl }}>
                        {credentials.baseUrl}
                      </Typography.Text>
                    </Typography.Text>
                    <Typography.Text>
                      Username:{' '}
                      <Typography.Text code copyable={{ text: credentials.username }}>
                        {credentials.username}
                      </Typography.Text>
                    </Typography.Text>
                    <Space size={8} align="center">
                      <Typography.Text>
                        Password:{' '}
                        <Typography.Text code copyable={{ text: credentials.password }}>
                          {showPassword ? credentials.password : '••••••••••••••••••••••••'}
                        </Typography.Text>
                      </Typography.Text>
                      <Button size="small" onClick={() => setShowPassword((v) => !v)}>
                        {showPassword ? 'Hide' : 'Show'}
                      </Button>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Copy these into your Unicommerce account's "Ratio" channel settings.
                    </Typography.Text>
                  </Space>
                }
              />

              {/* Connection status (§7): proof-of-life from the last time Unicommerce
                  actually called any of our endpoints — distinct from whether
                  credentials merely exist on file. */}
              <Alert
                type={lastInboundCallAt ? 'info' : 'warning'}
                showIcon
                message={
                  lastInboundCallAt
                    ? `Connected — last heard from Unicommerce ${new Date(lastInboundCallAt).toLocaleString()}`
                    : "Credentials are set, but Unicommerce hasn't called us yet — paste the base URL/username/password above into its \"Ratio\" channel settings if you haven't already."
                }
              />

              {regenerate.isError && (
                <Alert
                  type="error"
                  showIcon
                  message="Regenerate failed"
                  description={(regenerate.error as Error).message}
                />
              )}

              <div style={{ textAlign: 'right' }}>
                <DangerButton
                  loading={regenerate.isPending}
                  onClick={() => setConfirmRegenerateOpen(true)}
                >
                  Regenerate credentials
                </DangerButton>
              </div>
            </>
          )}
        </Space>
      </Card>

      <WarningModal
        title="Regenerate credentials?"
        open={confirmRegenerateOpen}
        onOk={handleConfirmRegenerate}
        onCancel={() => setConfirmRegenerateOpen(false)}
        confirmLoading={regenerate.isPending}
      >
        <Typography.Text>
          This will immediately invalidate the current username and password — Unicommerce will
          stop being able to authenticate until you paste the new credentials into its "Ratio"
          channel settings.
        </Typography.Text>
      </WarningModal>
    </Space>
  );
}
