import { Alert, Card, Typography } from '@primathonos/orion';
import { createFileRoute } from '@tanstack/react-router';
import { useConfig } from '@/hooks/useConfig';

export const Route = createFileRoute('/install')({ component: InstallPage });

function InstallPage() {
  const config = useConfig();

  if (config.isLoading) return <Typography.Text>Loading…</Typography.Text>;

  const sdkUrl = config.data?.sdkUrl ?? 'https://cdn.wizzy.ai/sdk/v2/wizzy.min.js';
  const scriptTagStatus = config.data?.scriptTagStatus ?? 'disabled';

  return (
    <Card title="Storefront SDK Installation">
      <Typography.Paragraph>
        The Wizzy JS SDK is injected into your storefront via the Ratio ScriptTag API. Once
        registered, Wizzy's AI search widget loads automatically on every storefront page.
      </Typography.Paragraph>

      <Typography.Paragraph>
        <Typography.Text strong>SDK URL: </Typography.Text>
        <Typography.Text code style={{ wordBreak: 'break-all' }}>
          {sdkUrl}
        </Typography.Text>
      </Typography.Paragraph>

      {scriptTagStatus === 'pending_api' && (
        <Alert
          type="info"
          showIcon
          message="ScriptTag API pending"
          description="The Ratio ScriptTag API is not yet generally available. The SDK will be registered automatically once the API goes live — no action needed."
        />
      )}
      {scriptTagStatus === 'active' && (
        <Alert
          type="success"
          showIcon
          message="SDK active"
          description="The Wizzy SDK is registered and loading on your storefront."
        />
      )}
      {scriptTagStatus === 'error' && (
        <Alert
          type="error"
          showIcon
          message="SDK registration failed"
          description="The ScriptTag registration encountered an error. Check your configuration and try re-saving."
        />
      )}
      {scriptTagStatus === 'disabled' && (
        <Alert
          type="warning"
          showIcon
          message="SDK disabled"
          description="Enable the Wizzy integration on the Config page to register the SDK."
        />
      )}
    </Card>
  );
}
