import {
  Alert,
  Card,
  CheckOutlined,
  CopyOutlined,
  message,
  Segmented,
  Space,
  SuccessTag,
  ThunderboltOutlined,
  Typography,
} from '@primathonos/orion';
import { useState } from 'react';

interface Props {
  merchantId: string;
}

type Target = 'nextjs' | 'html';

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      message.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      message.error('Could not copy — select the snippet manually');
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        background: '#0d1117',
        border: '1px solid #1f2630',
        borderRadius: 10,
        padding: '16px 18px',
      }}
    >
      <button
        type="button"
        onClick={copy}
        aria-label="Copy snippet"
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: copied ? '#1f6f43' : '#21262d',
          color: '#e6edf3',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
      >
        {copied ? <CheckOutlined /> : <CopyOutlined />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre
        style={{
          margin: 0,
          paddingRight: 64,
          color: '#e6edf3',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 13,
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function StepRow({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: '#1677ff',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 600,
          marginTop: 2,
        }}
      >
        {n}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Typography.Text strong style={{ fontSize: 15 }}>
          {title}
        </Typography.Text>
        <div style={{ marginTop: 10 }}>{children}</div>
      </div>
    </div>
  );
}

export function ScriptTagPanel({ merchantId }: Props) {
  const [target, setTarget] = useState<Target>('nextjs');

  const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  const apiBase = rawBase.endsWith('/') ? `${rawBase.slice(0, -1)}/posthog` : `${rawBase}/posthog`;
  const scriptUrl = `${apiBase}/sdk/${merchantId}.js`;

  const nextjsSnippet = `<Script\n  src="${scriptUrl}"\n  strategy="afterInteractive"\n/>`;
  const htmlSnippet = `<script src="${scriptUrl}" defer></script>`;
  const snippet = target === 'nextjs' ? nextjsSnippet : htmlSnippet;

  const pixelConfigSnippet = `// apps/<merchant>/lib/pixelConfig.ts\nexport const pixelConfig = {\n  // ...your other pixels\n  "posthog-ratio": {},\n};`;

  return (
    <Card
      title="Install PostHog on your storefront"
      extra={<SuccessTag>Self-registering SDK</SuccessTag>}
    >
      <Space direction="vertical" size={28} style={{ display: 'flex' }}>
        <Segmented
          value={target}
          onChange={(value) => setTarget(value as Target)}
          options={[
            { label: 'Next.js (App Router)', value: 'nextjs' },
            { label: 'Plain HTML', value: 'html' },
          ]}
        />

        <StepRow n={1} title="Add the SDK script">
          <Space direction="vertical" size={10} style={{ display: 'flex' }}>
            {target === 'nextjs' ? (
              <Typography.Text type="secondary">
                Drop this next to your other Pixel SDK tags in your root layout{' '}
                <Typography.Text code>src/app/layout.tsx</Typography.Text>. Import{' '}
                <Typography.Text code>Script</Typography.Text> from{' '}
                <Typography.Text code>next/script</Typography.Text> if it isn&apos;t already.
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">
                Paste this into the <Typography.Text code>&lt;head&gt;</Typography.Text> of your
                storefront, alongside your other analytics tags.
              </Typography.Text>
            )}
            <CodeBlock code={snippet} />
          </Space>
        </StepRow>

        <StepRow n={2} title="Activate it in your pixel config">
          <Space direction="vertical" size={10} style={{ display: 'flex' }}>
            <Typography.Text type="secondary">
              Add the <Typography.Text code>posthog-ratio</Typography.Text> key to{' '}
              <Typography.Text code>apps/&lt;merchant&gt;/lib/pixelConfig.ts</Typography.Text>. This
              is the switch the OpenStore PixelRuntime uses to activate the SDK — without it the
              script loads but stays dormant.
            </Typography.Text>
            <CodeBlock code={pixelConfigSnippet} />
          </Space>
        </StepRow>

        <StepRow n={3} title="That's it — events start flowing">
          <Alert
            type="success"
            showIcon
            icon={<ThunderboltOutlined />}
            message="The SDK self-registers and activates on the next page load"
            description="Leave the config value as an empty object — your PostHog API key, host, and event mapping are baked into the script straight from the Config tab, so there's nothing else to fill in here."
          />
        </StepRow>
      </Space>
    </Card>
  );
}
