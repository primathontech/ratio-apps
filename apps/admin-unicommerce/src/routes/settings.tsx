import { Alert, Card, Checkbox, PrimaryButton, Space, Spin, Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useMerchant } from '@/hooks/useMerchant';
import { useConfig, useUpdateConfig } from '@/hooks/useUnicommerce';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

export function SettingsPage() {
  const { data: merchant } = useMerchant();
  const merchantId = merchant?.id;

  const [productSyncEnabled, setProductSyncEnabled] = useState(false);
  const [inventorySyncEnabled, setInventorySyncEnabled] = useState(false);
  const [orderPushEnabled, setOrderPushEnabled] = useState(false);
  const [dispatchStatusSyncEnabled, setDispatchStatusSyncEnabled] = useState(false);
  const [cancelSyncEnabled, setCancelSyncEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const config = useConfig(merchantId);
  const updateConfig = useUpdateConfig(merchantId);

  useEffect(() => {
    if (config.data) {
      setProductSyncEnabled(config.data.productSyncEnabled);
      setInventorySyncEnabled(config.data.inventorySyncEnabled);
      setOrderPushEnabled(config.data.orderPushEnabled);
      setDispatchStatusSyncEnabled(config.data.dispatchStatusSyncEnabled);
      setCancelSyncEnabled(config.data.cancelSyncEnabled);
      setNotificationsEnabled(config.data.notificationsEnabled);
    }
  }, [config.data]);

  if (config.isLoading) {
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
          Settings
        </Typography.Title>
        <Typography.Text type="secondary">
          Per-merchant feature flags for the Unicommerce connector — what gets synced and in which
          direction. Save applies the changes immediately.
        </Typography.Text>
      </div>

      <Card title="Sync & notifications">
        <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
          {config.isError && (
            <Alert
              type="error"
              showIcon
              message="Couldn't load settings"
              description={(config.error as Error).message}
            />
          )}

          <div>
            <Checkbox
              checked={productSyncEnabled}
              onChange={(e) => setProductSyncEnabled(e.target.checked)}
            >
              Product sync
            </Checkbox>
            <div>
              <Typography.Text type="secondary">
                Lets Unicommerce pull your product catalog.
              </Typography.Text>
            </div>
          </div>

          <div>
            <Checkbox
              checked={inventorySyncEnabled}
              onChange={(e) => setInventorySyncEnabled(e.target.checked)}
            >
              Inventory sync
            </Checkbox>
            <div>
              <Typography.Text type="secondary">
                Lets Unicommerce push stock-level updates into Ratio.
              </Typography.Text>
            </div>
          </div>

          <div>
            <Checkbox
              checked={orderPushEnabled}
              onChange={(e) => setOrderPushEnabled(e.target.checked)}
            >
              Order push
            </Checkbox>
            <div>
              <Typography.Text type="secondary">
                Pushes new Ratio orders out to Unicommerce.
              </Typography.Text>
            </div>
          </div>

          <div>
            <Checkbox
              checked={dispatchStatusSyncEnabled}
              onChange={(e) => setDispatchStatusSyncEnabled(e.target.checked)}
            >
              Dispatch &amp; status sync
            </Checkbox>
            <div>
              <Typography.Text type="secondary">
                Accepts dispatch and shipment-status updates from Unicommerce.
              </Typography.Text>
            </div>
          </div>

          <div>
            <Checkbox
              checked={cancelSyncEnabled}
              onChange={(e) => setCancelSyncEnabled(e.target.checked)}
            >
              Cancel sync
            </Checkbox>
            <div>
              <Typography.Text type="secondary">
                Syncs order cancellations in both directions.
              </Typography.Text>
            </div>
          </div>

          <div>
            <Checkbox checked={notificationsEnabled} disabled>
              Notifications
            </Checkbox>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Not yet available — no notification channel is implemented for this connector yet.
              </Typography.Text>
            </div>
          </div>

          {updateConfig.isSuccess && <Alert type="success" showIcon message="Settings saved." />}
          {updateConfig.isError && (
            <Alert
              type="error"
              showIcon
              message="Couldn't save settings"
              description={(updateConfig.error as Error).message}
            />
          )}

          <div style={{ textAlign: 'right' }}>
            <PrimaryButton
              loading={updateConfig.isPending}
              disabled={!merchantId}
              onClick={() =>
                updateConfig.mutate({
                  productSyncEnabled,
                  inventorySyncEnabled,
                  orderPushEnabled,
                  dispatchStatusSyncEnabled,
                  cancelSyncEnabled,
                  notificationsEnabled,
                })
              }
            >
              Save settings
            </PrimaryButton>
          </div>
        </Space>
      </Card>
    </Space>
  );
}
