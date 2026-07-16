import { Typography } from '@primathonos/orion';
import type { FormField } from '@shared/schemas/form-schema';
import type { CSSProperties } from 'react';

interface Props {
  name: string;
  fields: FormField[];
  submitLabel: string;
  /** 375px frame vs full-width split pane. */
  mode: 'mobile' | 'desktop';
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid #d9d9d9',
  borderRadius: 6,
  background: '#fafafa',
  color: '#666',
  fontSize: 14,
  boxSizing: 'border-box',
};

/**
 * Read-only render of the CURRENT builder schema (local state, not the saved
 * form) — what the storefront SDK will roughly produce. Everything is
 * disabled: this is a preview, not a working form.
 */
export function FormPreview({ name, fields, submitLabel, mode }: Props) {
  return (
    <div
      data-testid={`preview-${mode}`}
      style={{
        width: mode === 'mobile' ? 375 : '100%',
        maxWidth: '100%',
        border: '1px solid #e5e5e5',
        borderRadius: 8,
        padding: 16,
        background: '#fff',
        margin: mode === 'mobile' ? '0 auto' : undefined,
      }}
    >
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {name || 'Untitled form'}
      </Typography.Title>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map((field) => (
          <PreviewField key={field.key} field={field} />
        ))}
        <button
          type="button"
          disabled
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: '#1677ff',
            color: '#fff',
            opacity: 0.7,
            alignSelf: 'flex-start',
          }}
        >
          {submitLabel || 'Submit'}
        </button>
      </div>
    </div>
  );
}

function PreviewField({ field }: { field: FormField }) {
  // A div, not a <label>: every control is disabled in the preview, and
  // multi_select/file variants have no single labelable control.
  return (
    <div>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {field.label}
        {field.required && <span style={{ color: '#cf1322' }}> *</span>}
      </span>
      <PreviewControl field={field} />
    </div>
  );
}

function PreviewControl({ field }: { field: FormField }) {
  switch (field.type) {
    case 'textarea':
      return <textarea disabled rows={3} placeholder={field.placeholder} style={inputStyle} />;
    case 'dropdown':
      return (
        <select disabled style={inputStyle}>
          <option>{field.placeholder ?? 'Select...'}</option>
          {field.options.map((opt) => (
            <option key={opt}>{opt}</option>
          ))}
        </select>
      );
    case 'multi_select':
      return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {field.options.map((opt) => (
            <span key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input type="checkbox" disabled /> {opt}
            </span>
          ))}
        </span>
      );
    case 'date':
      return <input disabled type="date" style={inputStyle} />;
    case 'file':
      return <input disabled type="file" style={{ ...inputStyle, padding: 6 }} />;
    case 'phone':
      return (
        <span style={{ display: 'flex', gap: 6 }}>
          <span style={{ ...inputStyle, width: 52, textAlign: 'center', flex: 'none' }}>+91</span>
          <input disabled placeholder={field.placeholder ?? '10-digit number'} style={inputStyle} />
        </span>
      );
    default:
      return (
        <input
          disabled
          type={field.type === 'email' ? 'email' : 'text'}
          placeholder={field.placeholder}
          style={inputStyle}
        />
      );
  }
}
