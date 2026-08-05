import { createFileRoute } from '@tanstack/react-router';
import { PlannedScreen } from '@/components/PlannedScreen';

export const Route = createFileRoute('/appearance')({ component: AppearancePage });

function AppearancePage() {
  return (
    <PlannedScreen
      title="Appearance"
      purpose="How the frequently-bought-together widget looks on the storefront."
      plan="Plan 4 (admin screens) and Plan 5 (storefront SDK)"
      controls={[
        'Widget title (e.g. "Frequently Bought Together")',
        'Layout style and price layout',
        'Accent colour, corner style, and image aspect ratio',
        'Show or hide the per-item checkboxes',
        'Theme settings, with a live preview of the result',
      ]}
    />
  );
}
