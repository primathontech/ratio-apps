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
 * Persistent live preview (B2). A full-width panel at the top of the builder
 * that reflects the current builder state as it changes, so merchants never
 * leave the editor to see their form. A device toggle switches the embedded
 * FormPreview between the wide desktop frame and the 375px mobile frame; with
 * the panel now full width the desktop frame has real room to differ from
 * mobile. FormPreview owns the Ready/Success/Error/Closed state control.
 */
export function LivePreview(props: Props) {
  const [device, setDevice] = useState<Device>('desktop');
  return (
    <Card
      title="Live preview"
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
