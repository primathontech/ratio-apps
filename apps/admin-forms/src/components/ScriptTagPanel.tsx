import { Card, Typography } from '@primathonos/orion';

interface Props {
  merchantId: string;
}

export function ScriptTagPanel({ merchantId }: Props) {
  const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  const apiBase = rawBase.endsWith('/')
    ? `${rawBase.slice(0, -1)}/forms`
    : `${rawBase}/forms`;
  const scriptUrl = `${apiBase}/sdk/${merchantId}.js`;
  const scriptTag = `<Script src="${scriptUrl}" strategy="afterInteractive" />`;
  const pixelConfigLine = `"forms-ratio": {},`;

  return (
    <Card
      title="Install on your storefront"
      extra={
        <Typography.Text type="secondary">2 steps — config comes from this app, not env vars</Typography.Text>
      }
    >
      <Typography.Paragraph strong style={{ marginBottom: 4 }}>
        1. Add the script to <Typography.Text code>src/app/layout.tsx</Typography.Text> (with the other pixel SDKs):
      </Typography.Paragraph>
      <Typography.Paragraph copyable={{ text: scriptTag }}>
        <Typography.Text code style={{ wordBreak: 'break-all' }}>
          {scriptTag}
        </Typography.Text>
      </Typography.Paragraph>

      <Typography.Paragraph strong style={{ marginBottom: 4 }}>
        2. Activate it in <Typography.Text code>src/config/pixelConfig.ts</Typography.Text>:
      </Typography.Paragraph>
      <Typography.Paragraph copyable={{ text: pixelConfigLine }}>
        <Typography.Text code>{pixelConfigLine}</Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        The PixelRuntime then activates this SDK on the next page load; config is served from this app.
      </Typography.Paragraph>
    </Card>
  );
}
