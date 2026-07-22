import { Card, Select, Space, Typography } from '@primathonos/orion';
import { useState } from 'react';
import type { FormListItem } from '@/hooks/useForms';

interface Props {
  merchantId: string;
  forms: FormListItem[];
}

/**
 * Embed instructions (PRD "Install/embed"). Two supported methods, both keyed
 * off the same form picker so multi-form merchants pick which form each snippet
 * targets:
 *   A. SDK  — one <script> per merchant + a <div data-ratio-form> per form.
 *             The single SDK auto-mounts EVERY data-ratio-form on the page, so
 *             several forms on one page = several divs with different ids.
 *   B. iframe — a single self-contained <iframe> per form; no script, frameable
 *             on any site.
 *
 * Snippets need the ABSOLUTE backend origin. VITE_API_BASE_URL must be set to
 * the public forms host at build time; if it's empty we emit a visible
 * placeholder rather than a silently-broken relative URL.
 */
const ORIGIN_PLACEHOLDER = 'https://YOUR-FORMS-HOST';

export function ScriptTagPanel({ merchantId, forms }: Props) {
  const rawBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';
  const trimmed = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  const apiBase = trimmed || ORIGIN_PLACEHOLDER;
  const [formId, setFormId] = useState<string | undefined>(forms[0]?.id);
  const fid = formId ?? 'FORM_ID';

  const scriptTag = `<script src="${apiBase}/forms/sdk/${merchantId}.js" defer></script>`;
  const embedSnippet = `<div data-ratio-form="${fid}"></div>`;
  const iframeSnippet = `<iframe src="${apiBase}/forms/embed/${fid}" width="100%" height="640" style="border:0" title="Form"></iframe>`;

  return (
    <Card
      title="Install on your storefront"
      extra={<Typography.Text type="secondary">Pick a form, then copy either method</Typography.Text>}
    >
      <Space direction="vertical" size="middle" style={{ display: 'flex' }}>
        {forms.length > 0 && (
          <div style={{ maxWidth: 360 }}>
            <Typography.Paragraph strong style={{ marginBottom: 4 }}>
              Form
            </Typography.Paragraph>
            <Select
              aria-label="Form"
              value={formId}
              onChange={(v) => setFormId(v as string)}
              options={forms.map((f) => ({ value: f.id, label: f.name }))}
              style={{ width: '100%' }}
            />
          </div>
        )}

        {!trimmed && (
          <Typography.Paragraph type="warning" style={{ marginBottom: 0 }}>
            Replace <Typography.Text code>{ORIGIN_PLACEHOLDER}</Typography.Text> with your public
            forms backend URL (set <Typography.Text code>VITE_API_BASE_URL</Typography.Text> at build
            time so this is filled in automatically).
          </Typography.Paragraph>
        )}

        <div>
          <Typography.Paragraph strong style={{ marginBottom: 4 }}>
            Method A — SDK (recommended): add the script once before{' '}
            <Typography.Text code>&lt;/body&gt;</Typography.Text>…
          </Typography.Paragraph>
          <Typography.Paragraph copyable={{ text: scriptTag }} style={{ marginBottom: 8 }}>
            <Typography.Text code style={{ wordBreak: 'break-all' }}>
              {scriptTag}
            </Typography.Text>
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            …then drop a mount point wherever the form should render (one per form):
          </Typography.Paragraph>
          <Typography.Paragraph copyable={{ text: embedSnippet }} style={{ marginBottom: 0 }}>
            <Typography.Text code style={{ wordBreak: 'break-all' }}>
              {embedSnippet}
            </Typography.Text>
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Paragraph strong style={{ marginBottom: 4 }}>
            Method B — iframe: paste this one line into any page (no script needed):
          </Typography.Paragraph>
          <Typography.Paragraph copyable={{ text: iframeSnippet }} style={{ marginBottom: 0 }}>
            <Typography.Text code style={{ wordBreak: 'break-all' }}>
              {iframeSnippet}
            </Typography.Text>
          </Typography.Paragraph>
        </div>

        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          The SDK upgrades every <Typography.Text code>data-ratio-form</Typography.Text> element on
          the page into the published form, so multiple forms on one page just means multiple mount
          points with different ids. Inactive forms show a "form closed" message instead.
        </Typography.Paragraph>
      </Space>
    </Card>
  );
}
