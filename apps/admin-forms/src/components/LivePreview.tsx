import { Card, Segmented } from '@primathonos/orion';
import type { FormAppearance, FormField } from '@shared/schemas/form-schema';
import { useState } from 'react';
import { FormPreview } from '@/components/FormPreview';

type Device = 'desktop' | 'mobile';

const DEVICE_OPTIONS: { label: string; value: Device }[] = [
  { label: 'Desktop', value: 'desktop' },
  { label: 'Mobile', value: 'mobile' },
];

interface Props {
  name: string;
  fields: FormField[];
  submitLabel: string;
  successMessage: string;
  description: string;
  appearance?: FormAppearance | undefined;
}

/**
 * Persistent live preview (B2). Renders beside the editor and reflects the
 * current builder state as it changes, so merchants never leave the editor to
 * see their form. A device toggle switches the embedded FormPreview between the
 * desktop and mobile (375px) frames; FormPreview owns the Ready/Success/Error/
 * Closed state control.
 */
export function LivePreview(props: Props) {
  const [device, setDevice] = useState<Device>('desktop');
  return (
    <Card
      title="Live preview"
      style={{ flex: '1 1 340px', minWidth: 300 }}
      extra={
        <Segmented
          aria-label="Preview device"
          size="small"
          options={DEVICE_OPTIONS}
          value={device}
          onChange={(value) => setDevice(value as Device)}
        />
      }
    >
      <FormPreview
        name={props.name}
        fields={props.fields}
        submitLabel={props.submitLabel}
        successMessage={props.successMessage}
        description={props.description}
        appearance={props.appearance}
        mode={device}
      />
    </Card>
  );
}
