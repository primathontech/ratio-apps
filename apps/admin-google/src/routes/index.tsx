import {
  Alert,
  Card,
  Col,
  PrimaryButton,
  Row,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
} from '@primathonos/orion';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useConfig, useUpdateConfig } from '@/hooks/useConfig';
import { useFeedSummary, useForceSync } from '@/hooks/useFeed';
import { startGoogleConnect } from '@/lib/oauth';

export const Route = createFileRoute('/')({ component: Overview });

export function Overview() {
  const config = useConfig();
  const update = useUpdateConfig();
  const summary = useFeedSummary();
  const forceSync = useForceSync();

  if (config.isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const data = config.data;

  return (
    <Space direction="vertical" size="large" style={{ display: 'flex' }}>
      <div>
        <Typography.Title
          level={2}
          style={{ marginBottom: 0, fontSize: 'clamp(20px, 5vw, 30px)', lineHeight: 1.2 }}
        >
          Google Integration for Ratio
        </Typography.Title>
        <Typography.Text type="secondary">
          GA4 analytics, Google Ads conversions, and Merchant Center product feed — at a glance.
        </Typography.Text>
      </div>

      {data?.needsReconnect && (
        <Alert
          type="warning"
          showIcon
          message="Google connection needs attention"
          description="Your Google authorization expired or was revoked. Reconnect to resume syncing."
          action={
            <PrimaryButton
              onClick={() => {
                // Always refetch when the popup flow ends so the UI self-corrects
                // even if the postMessage was missed.
                void startGoogleConnect().finally(() => void config.refetch());
              }}
            >
              Reconnect Google
            </PrimaryButton>
          }
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card title="Google Analytics 4" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <div>
                <Typography.Text type="secondary">Measurement ID</Typography.Text>
                <div>
                  <Typography.Text code>{data?.ga4MeasurementId || 'Not set'}</Typography.Text>
                </div>
              </div>
              <div>
                <Tag color={data?.ga4Enabled ? 'green' : 'default'}>
                  {data?.ga4Enabled ? 'Configured' : 'Not configured'}
                </Tag>
              </div>
              <Link to="/config">
                <PrimaryButton>Configure GA4</PrimaryButton>
              </Link>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card title="Google Ads" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <div>
                <Typography.Text type="secondary">Conversion ID</Typography.Text>
                <div>
                  <Typography.Text code>{data?.adsConversionId || 'Not set'}</Typography.Text>
                </div>
              </div>
              <div>
                <Tag color={data?.adsEnabled ? 'green' : 'default'}>
                  {data?.adsEnabled ? 'Configured' : 'Not configured'}
                </Tag>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Tracking purchase &amp; add-to-cart conversion actions.
              </Typography.Text>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Switch
                  checked={data?.enhancedConversionsEnabled ?? false}
                  loading={update.isPending}
                  onChange={(checked) => {
                    if (!data) return;
                    update.mutate({
                      connectionMethod: data.connectionMethod,
                      ga4Enabled: data.ga4Enabled,
                      ga4MeasurementId: data.ga4MeasurementId,
                      adsEnabled: data.adsEnabled,
                      adsConversionId: data.adsConversionId,
                      adsConversionLabel: data.adsConversionLabel,
                      enhancedConversionsEnabled: checked,
                      gmcEnabled: data.gmcEnabled,
                      gmcMerchantId: data.gmcMerchantId,
                      gmcTargetCountry: data.gmcTargetCountry,
                      gmcContentLanguage: data.gmcContentLanguage,
                      gmcCurrency: data.gmcCurrency,
                      gmcDefaultCondition: data.gmcDefaultCondition,
                      gmcBrandOverride: data.gmcBrandOverride,
                      gmcGoogleProductCategory: data.gmcGoogleProductCategory,
                      gmcCategoryMode: data.gmcCategoryMode,
                      autoSyncEnabled: data.autoSyncEnabled,
                      hourlyReconcileEnabled: data.hourlyReconcileEnabled,
                      syncVariantsEnabled: data.syncVariantsEnabled,
                      includeOutOfStock: data.includeOutOfStock,
                      freeListingsEnabled: data.freeListingsEnabled,
                    });
                  }}
                />
                <Typography.Text>Enhanced conversions</Typography.Text>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={8}>
          <Card title="Merchant Center" style={{ height: '100%' }}>
            <Space direction="vertical" size="small" style={{ display: 'flex' }}>
              <div>
                <Typography.Text type="secondary">Merchant ID</Typography.Text>
                <div>
                  <Typography.Text code>{data?.gmcMerchantId || 'Not set'}</Typography.Text>
                </div>
              </div>
              <Row gutter={8}>
                <Col span={8}>
                  <Statistic title="Synced" value={summary.data?.synced ?? 0} />
                </Col>
                <Col span={8}>
                  <Statistic title="Warnings" value={summary.data?.warnings ?? 0} />
                </Col>
                <Col span={8}>
                  <Statistic title="Errors" value={summary.data?.errors ?? 0} />
                </Col>
              </Row>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Last sync:{' '}
                {summary.data?.lastSyncAt
                  ? new Date(summary.data.lastSyncAt).toLocaleString()
                  : 'never'}
              </Typography.Text>
              <Space wrap>
                <PrimaryButton loading={forceSync.isPending} onClick={() => forceSync.mutate()}>
                  Force Sync Now
                </PrimaryButton>
                <Link to="/feed">
                  <PrimaryButton ghost>View Feed Details</PrimaryButton>
                </Link>
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
