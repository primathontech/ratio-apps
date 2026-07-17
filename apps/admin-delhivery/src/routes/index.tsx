import {
  Card,
  CheckCircleOutlined,
  MinusCircleOutlined,
  PrimaryButton,
  Space,
  Tag,
  Typography,
} from '@primathonos/orion';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useConfig } from '@/hooks/useConfig';
import { useMerchant } from '@/hooks/useMerchant';

export const Route = createFileRoute('/')({ component: Overview });

export function Overview() {
  const merchant = useMerchant();
  const config = useConfig();
  const tokenSet = !!config.data?.hasApiToken;
  const enabled = !!config.data?.enabled;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Delhivery Direct for Ratio
        </Typography.Title>
        <Typography.Text type="secondary">
          Auto-create AWBs on paid orders, print labels, and track shipments using your own
          Delhivery Express account.
        </Typography.Text>
      </div>

      <Card title="Setup status">
        <Space direction="vertical" style={{ display: 'flex' }}>
          <Step done={!!merchant.data?.isActive} label="Ratio install" />
          <Step done={tokenSet} label="Delhivery API token" />
          <Step done={tokenSet && enabled} label="Shipping enabled" />
          {config.data && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text type="secondary">AWB trigger:</Typography.Text>
              <Tag color={config.data.awbTrigger === 'auto' ? 'green' : 'blue'}>
                {config.data.awbTrigger === 'auto' ? 'Auto (on paid order)' : 'Manual'}
              </Tag>
            </div>
          )}
        </Space>
        <Space wrap style={{ marginTop: 16 }}>
          <Link to="/config">
            <PrimaryButton>Configure Delhivery</PrimaryButton>
          </Link>
          <Link to="/shipments">
            <PrimaryButton ghost>View shipments</PrimaryButton>
          </Link>
        </Space>
      </Card>

      <Card title="How it works">
        <Space direction="vertical" size="small" style={{ display: 'flex' }}>
          <Typography.Text>
            1. Save your Delhivery API token, pickup location and GSTIN on the Config screen.
          </Typography.Text>
          <Typography.Text>
            2. When an order is paid, the AWB is created automatically (or manually from Shipments,
            if you prefer).
          </Typography.Text>
          <Typography.Text>
            3. Print labels from the Shipments screen; tracking is synced back to the order. NDR,
            COD remittance and claims stay in your Delhivery dashboard.
          </Typography.Text>
        </Space>
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
