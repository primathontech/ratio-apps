import { createFileRoute } from '@tanstack/react-router';
import { PlannedScreen } from '@/components/PlannedScreen';

export const Route = createFileRoute('/bundles')({ component: BundlesPage });

function BundlesPage() {
  return (
    <PlannedScreen
      title="Bundles"
      purpose="Manual bundles you build, and automatic bundles the recommendation engine generates."
      plan="Plan 2 (bundles API) and Plan 4 (admin screens)"
      controls={[
        'Bundle list with status (published / draft / paused) and manual vs automatic origin',
        'Create and edit via the three-step wizard: Basics & Scope → UI Module → Review & Publish',
        'Product and collection selection per bundle',
        'Duplicate, delete, and publish/pause a bundle',
        'Per-bundle preview before publishing',
      ]}
    />
  );
}
