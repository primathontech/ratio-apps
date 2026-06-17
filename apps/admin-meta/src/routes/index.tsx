import {
  Card,
  CheckCircleOutlined,
  MinusCircleOutlined,
  PrimaryButton,
  Space,
  Typography,
} from '@primathonos/orion';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useConfig } from '@/hooks/useConfig';
import { useMerchant } from '@/hooks/useMerchant';

// META: This is the admin dashboard shell. Build your vendor's admin
// screens as TanStack Router routes under src/routes/ (config form, dashboards,
// etc.) and back them with the `/meta/api/*` endpoints from your backend
// module. The config form pattern lives in src/routes/config.tsx.
export const Route = createFileRoute('/')({ component: Overview });

function Overview() {
  const merchant = useMerchant();
  const config = useConfig();
  const pixelIdSet = !!(config.data?.pixelId && config.data.pixelId.length > 0);

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Meta for Ratio
        </Typography.Title>
        <Typography.Text type="secondary">
          Forward storefront events to your Meta project.
        </Typography.Text>
      </div>
      <Card title="Setup status">
        <Space direction="vertical" style={{ display: 'flex' }}>
          <Step done={!!merchant.data?.isActive} label="Ratio install" />
          <Step done={pixelIdSet} label="Meta credentials" />
          <Step done={false} label="Storefront script installed (manual)" />
        </Space>
        <div style={{ marginTop: 16 }}>
          {!pixelIdSet ? (
            <Link to="/config">
              <PrimaryButton>Enter Meta credentials</PrimaryButton>
            </Link>
          ) : (
            <Link to="/install">
              <PrimaryButton>Get script tag</PrimaryButton>
            </Link>
          )}
        </div>
      </Card>
    </Space>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {done ? (
        <CheckCircleOutlined style={{ color: '#34a853' }} />
      ) : (
        <MinusCircleOutlined style={{ color: '#bdbdbd' }} />
      )}
      <Typography.Text {...(done ? {} : { type: 'secondary' as const })}>{label}</Typography.Text>
    </div>
  );
}
