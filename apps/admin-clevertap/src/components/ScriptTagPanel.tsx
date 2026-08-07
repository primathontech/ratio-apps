import { Alert, Button, Card, Space, Typography } from '@primathonos/orion';
import { useState } from 'react';

interface Props {
  merchantId: string;
}

export function clevertapApiBase(): string {
  const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  return rawBase.endsWith('/') ? `${rawBase.slice(0, -1)}/clevertap` : `${rawBase}/clevertap`;
}

export function scriptTagFor(merchantId: string): string {
  return `<Script src="${clevertapApiBase()}/sdk/${merchantId}.js" strategy="afterInteractive" />`;
}

export const PIXEL_CONFIG_LINE = '"clevertap-ratio": {},';

export function ScriptTagPanel({ merchantId }: Props) {
  const scriptTag = scriptTagFor(merchantId);
  const [copied, setCopied] = useState<'script' | 'config' | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  const copy = async (text: string, which: 'script' | 'config') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setCopyFailed(false);
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
  };

  return (
    <Card
      title="Install on your storefront"
      extra={
        <Typography.Text type="secondary">
          2 steps: config comes from this app, not env vars
        </Typography.Text>
      }
    >
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <div>
          <Typography.Paragraph strong style={{ marginBottom: 4 }}>
            1. Add the script to <Typography.Text code>src/app/layout.tsx</Typography.Text> (with
            the other pixel SDKs):
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 8 }}>
            <Typography.Text code style={{ wordBreak: 'break-all' }}>
              {scriptTag}
            </Typography.Text>
          </Typography.Paragraph>
          <Button onClick={() => copy(scriptTag, 'script')}>Copy script tag</Button>
          {copied === 'script' && (
            <Alert
              type="success"
              showIcon
              message="Copied to clipboard."
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        <div>
          <Typography.Paragraph strong style={{ marginBottom: 4 }}>
            2. Activate it in <Typography.Text code>src/config/pixelConfig.ts</Typography.Text>:
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 8 }}>
            <Typography.Text code>{PIXEL_CONFIG_LINE}</Typography.Text>
          </Typography.Paragraph>
          <Button onClick={() => copy(PIXEL_CONFIG_LINE, 'config')}>Copy config line</Button>
          {copied === 'config' && (
            <Alert
              type="success"
              showIcon
              message="Copied to clipboard."
              style={{ marginTop: 8 }}
            />
          )}
        </div>

        {copyFailed && (
          <Alert
            type="warning"
            showIcon
            message="Couldn't access the clipboard. Select the snippet above and copy it manually."
          />
        )}

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          The PixelRuntime then activates this SDK on the next page load. Every CleverTap setting
          (Account ID, region, event names) is served from this app in the script's own config
          prelude, so there are no storefront env vars to set.
        </Typography.Paragraph>
      </Space>
    </Card>
  );
}
