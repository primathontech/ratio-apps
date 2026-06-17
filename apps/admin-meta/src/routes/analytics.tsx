import { Space, Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { CapiStatsPanel } from '@/components/CapiStatsPanel';

export const Route = createFileRoute('/analytics')({ component: AnalyticsPage });

function AnalyticsPage() {
  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 0 }}>
          Analytics
        </Typography.Title>
        <Typography.Text type="secondary">
          Conversions API delivery — success rate, volume, and failure reasons.
        </Typography.Text>
      </div>
      <CapiStatsPanel days={30} />
    </Space>
  );
}
