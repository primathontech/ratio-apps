import { Card, Select, Space, Typography } from '@primathonos/orion';
import { useState } from 'react';
import type { FormListItem } from '@/hooks/useForms';

interface Props {
  merchantId: string;
  forms: FormListItem[];
}

/**
 * Embed instructions (PRD "Install/embed"): the per-merchant SDK script tag
 * plus a per-form `<div data-ratio-form>` mount snippet, with a form picker.
 */
export function ScriptTagPanel({ merchantId, forms }: Props) {
  const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  const apiBase = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const [formId, setFormId] = useState<string | undefined>(forms[0]?.id);

  const scriptTag = `<script src="${apiBase}/forms/sdk/${merchantId}.js" defer></script>`;
  const embedSnippet = `<div data-ratio-form="${formId ?? 'FORM_ID'}"></div>`;

  return (
    <Card
      title="Install on your storefront"
      extra={<Typography.Text type="secondary">2 steps</Typography.Text>}
    >
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        <div>
          <Typography.Paragraph strong style={{ marginBottom: 4 }}>
            1. Add the SDK script once, before <Typography.Text code>&lt;/body&gt;</Typography.Text>
            :
          </Typography.Paragraph>
          <Typography.Paragraph copyable={{ text: scriptTag }} style={{ marginBottom: 0 }}>
            <Typography.Text code style={{ wordBreak: 'break-all' }}>
              {scriptTag}
            </Typography.Text>
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Paragraph strong style={{ marginBottom: 4 }}>
            2. Drop a mount point where the form should render:
          </Typography.Paragraph>
          {forms.length > 0 && (
            <div style={{ marginBottom: 8, maxWidth: 360 }}>
              <Select
                aria-label="Form"
                value={formId}
                onChange={(v) => setFormId(v as string)}
                options={forms.map((f) => ({ value: f.id, label: f.name }))}
                style={{ width: '100%' }}
              />
            </div>
          )}
          <Typography.Paragraph copyable={{ text: embedSnippet }} style={{ marginBottom: 0 }}>
            <Typography.Text code style={{ wordBreak: 'break-all' }}>
              {embedSnippet}
            </Typography.Text>
          </Typography.Paragraph>
        </div>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          The SDK upgrades every <Typography.Text code>data-ratio-form</Typography.Text> element on
          the page into the published form. Inactive forms show a "form closed" message instead.
        </Typography.Paragraph>
      </Space>
    </Card>
  );
}
