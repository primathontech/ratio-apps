import { createFileRoute } from '@tanstack/react-router';
import { PlannedScreen } from '@/components/PlannedScreen';

export const Route = createFileRoute('/preview')({ component: PreviewPage });

function PreviewPage() {
  return (
    <PlannedScreen
      title="Preview"
      purpose="See a bundle rendered as the storefront widget before it goes live."
      plan="Plan 4 (admin screens) and Plan 5 (storefront SDK)"
      controls={[
        'Live widget preview for a selected bundle',
        'Bundle details: name, status, mode, period, and target count',
        'The FBT items the bundle resolves to',
        'Copy the widget config JSON for debugging',
      ]}
    />
  );
}
