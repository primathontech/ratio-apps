import {
  Alert,
  Card,
  CheckCircleOutlined,
  MinusCircleOutlined,
  Space,
  Typography,
} from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useMerchant } from '@/hooks/useMerchant';

// The FBT dashboard. Mirrors `osapp-freq-bought/admin`'s dashboard screen,
// whose metrics come from `GET /dashboard`: bundle counts split by status
// (published / draft / paused) and by origin (manual / automatic), over the
// "All Campaigns" table.
//
// Only the install state is live here — `GET /fbt/api/merchants/me` exists.
// The metrics need the bundles API, which Plan 2 delivers.
export const Route = createFileRoute('/')({ component: Dashboard });

function Dashboard() {
  const merchant = useMerchant();

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Dashboard
        </Typography.Title>
        <Typography.Text type="secondary">
          Frequently-bought-together bundles for your storefront.
        </Typography.Text>
      </div>

      <Card title="Install status">
        <Space direction="vertical" style={{ display: 'flex' }}>
          <Step done={!!merchant.data?.isActive} label="Connected to Ratio" />
          {merchant.data && (
            <Typography.Text type="secondary">
              Merchant #{merchant.data.id} · installed{' '}
              {new Date(merchant.data.installedAt).toLocaleDateString()}
            </Typography.Text>
          )}
        </Space>
      </Card>

      <Card title="Bundle metrics">
        <Alert
          type="info"
          showIcon
          message="Delivered by Plan 2 (bundles API)."
          description="Published, draft, and paused bundle counts, split by manual vs automatic origin."
        />
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
