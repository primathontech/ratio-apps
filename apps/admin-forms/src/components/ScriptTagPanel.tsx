import { Card, Divider, Select, Space, Tag, Typography } from '@primathonos/orion';
import { useState } from 'react';
import type { FormListItem } from '@/hooks/useForms';

interface Props {
  merchantId: string;
  forms: FormListItem[];
}

/**
 * Embed instructions (PRD "Install/embed"). Two methods, keyed off one form picker:
 *   SDK    — <script> + <div data-ratio-form>. Renders inline at natural height and
 *            shrinks on the thank-you / closed states; recommended for in-page forms.
 *   iframe — a self-contained, fixed-height embed for a form on its own page.
 *
 * Snippets need the ABSOLUTE backend origin (VITE_API_BASE_URL at build time); if
 * unset we emit a visible placeholder instead of a silently-broken relative URL.
 */
const ORIGIN_PLACEHOLDER = 'https://YOUR-FORMS-HOST';

function CodeBlock({ code }: { code: string }) {
  return (
    <div
      style={{
        position: 'relative',
        background: '#f6f8fa',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        marginBottom: 4,
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: '10px 40px 10px 12px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 12.5,
          lineHeight: 1.6,
          whiteSpace: 'pre',
          overflowX: 'auto',
          color: '#24292f',
        }}
      >
        {code}
      </pre>
      <Typography.Text
        copyable={{ text: code }}
        style={{ position: 'absolute', top: 8, right: 10 }}
      />
    </div>
  );
}

export function ScriptTagPanel({ merchantId, forms }: Props) {
  const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  const trimmed = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const apiBase = trimmed || ORIGIN_PLACEHOLDER;
  const [formId, setFormId] = useState<string | undefined>(forms[0]?.id);
  const fid = formId ?? 'FORM_ID';

  const scriptTag = `<script src="${apiBase}/forms/sdk/${merchantId}.js" defer></script>`;
  const embedSnippet = `<div data-ratio-form="${fid}"></div>`;
  const iframeSnippet = `<iframe src="${apiBase}/forms/embed/${fid}" width="100%" height="800" style="border:0" title="Form"></iframe>`;

  return (
    <Card title="Install on your storefront">
      <Space direction="vertical" size="large" style={{ display: 'flex' }}>
        {forms.length > 0 && (
          <div style={{ maxWidth: 360 }}>
            <Typography.Text strong>Form</Typography.Text>
            <Select
              aria-label="Form"
              value={formId}
              onChange={(v) => setFormId(v as string)}
              options={forms.map((f) => ({ value: f.id, label: f.name }))}
              style={{ width: '100%', marginTop: 6 }}
            />
          </div>
        )}

        {!trimmed && (
          <Typography.Paragraph type="warning" style={{ marginBottom: 0 }}>
            Replace <Typography.Text code>{ORIGIN_PLACEHOLDER}</Typography.Text> with your public
            forms host (set <Typography.Text code>VITE_API_BASE_URL</Typography.Text> at build time).
          </Typography.Paragraph>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <Typography.Text strong>SDK</Typography.Text>
            <Tag color="green" bordered={false} style={{ marginInlineEnd: 0 }}>
              Recommended
            </Tag>
          </div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 10 }}>
            Place a form inside an existing page. Renders inline and resizes to fit, including the
            thank-you and closed states.
          </Typography.Paragraph>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            1. Add once, before <Typography.Text code>&lt;/body&gt;</Typography.Text>
          </Typography.Text>
          <div style={{ marginTop: 4 }}>
            <CodeBlock code={scriptTag} />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            2. Place where the form should appear (one per form)
          </Typography.Text>
          <div style={{ marginTop: 4 }}>
            <CodeBlock code={embedSnippet} />
          </div>
        </div>

        <Divider style={{ margin: 0 }} />

        <div>
          <Typography.Text strong>iframe</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ marginTop: 2, marginBottom: 10 }}>
            For a form on its own page. Fully isolated at a fixed height; it won't shrink on the
            thank-you or closed states.
          </Typography.Paragraph>
          <CodeBlock code={iframeSnippet} />
        </div>
      </Space>
    </Card>
  );
}
