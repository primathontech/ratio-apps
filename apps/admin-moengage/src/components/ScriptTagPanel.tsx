import { Card, Typography } from '@primathonos/orion';

interface Props {
  merchantId: string;
}

export function ScriptTagPanel({ merchantId }: Props) {
  const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  const apiBase = rawBase.endsWith('/')
    ? `${rawBase.slice(0, -1)}/moengage`
    : `${rawBase}/moengage`;
  const scriptUrl = `${apiBase}/sdk/${merchantId}.js`;
  const scriptTag = `<script src="${scriptUrl}" defer></script>`;

  return (
    <Card
      title="Install on your storefront"
      extra={
        <Typography.Text type="secondary">
          Paste into <code>&lt;head&gt;</code>
        </Typography.Text>
      }
    >
      <Typography.Paragraph copyable={{ text: scriptTag }}>
        <Typography.Text code>{scriptTag}</Typography.Text>
      </Typography.Paragraph>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Then add <Typography.Text code>{`"moengage-ratio": {}`}</Typography.Text> to{' '}
        <Typography.Text code>apps/&lt;merchant&gt;/lib/pixelConfig.ts</Typography.Text> so the
        OpenStore PixelRuntime activates this SDK on next page load.
      </Typography.Paragraph>
    </Card>
  );
}
