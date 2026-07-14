import { Alert, Card, Input, PrimaryButton, Select, Space, Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMerchantStore } from '@/stores/useMerchantStore';
import { useTestConnection, useActivate } from '@/hooks/useUnicommerce';

export const Route = createFileRoute('/config')({ component: Config });

function Config() {
  const token = useMerchantStore((s) => s.token);
  const merchantId = token ?? '';
  const [tenantSlug, setTenantSlug] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [facilityCode, setFacilityCode] = useState('');
  const [facilities, setFacilities] = useState<Array<{ code: string; name: string }>>([]);

  const testConnection = useTestConnection();
  const activate = useActivate();

  const handleTest = async () => {
    const result = await testConnection.mutateAsync({ tenantSlug, username, password });
    if (result.success && result.facilities) {
      setFacilities(result.facilities);
    }
  };

  const handleActivate = async () => {
    await activate.mutateAsync({ merchantId, tenantSlug, username, password, facilityCode });
    window.location.hash = '#/';
  };

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <Typography.Title level={3}>Unicommerce Configuration</Typography.Title>

      <Card title="Credentials" style={{ maxWidth: 500 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <Typography.Text>Tenant Slug</Typography.Text>
            <Input
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              placeholder="your-tenant"
            />
          </div>
          <div>
            <Typography.Text>Username</Typography.Text>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="api-user"
            />
          </div>
          <div>
            <Typography.Text>Password</Typography.Text>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <PrimaryButton
            loading={testConnection.isPending}
            onClick={handleTest}
            disabled={!tenantSlug || !username || !password}
          >
            Test Connection
          </PrimaryButton>
        </div>
      </Card>

      {testConnection.data?.error && (
        <Alert type="error" showIcon message={testConnection.data.error} />
      )}

      {facilities.length > 0 && (
        <Card title="Select Facility" style={{ maxWidth: 500 }}>
          <Space direction="vertical" size="small" style={{ display: 'flex' }}>
            <Select
              placeholder="Choose a facility"
              value={facilityCode || undefined}
              onChange={(value) => setFacilityCode(value as string)}
              options={facilities.map((f) => ({
                label: `${f.name} (${f.code})`,
                value: f.code,
              }))}
            />
            <PrimaryButton
              loading={activate.isPending}
              onClick={handleActivate}
              disabled={!facilityCode}
            >
              Activate
            </PrimaryButton>
          </Space>
        </Card>
      )}
    </Space>
  );
}
