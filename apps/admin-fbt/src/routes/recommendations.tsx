import { createFileRoute } from '@tanstack/react-router';
import { PlannedScreen } from '@/components/PlannedScreen';

export const Route = createFileRoute('/recommendations')({ component: RecommendationsPage });

// Backed by `fbt_merchant_config` (one row per merchant, seeded on install by
// FbtBootstrap) and the write shape in `@shared/schemas/fbt-config`.
//
// Carry-forward for whoever builds this: enabling `allowAutomaticRecommendation`
// must set `nextRunAt = NOW(3)` in the SAME write. Flipping the boolean and
// leaving scheduling stale means the merchant opts in and nothing ever runs.
function RecommendationsPage() {
  return (
    <PlannedScreen
      title="Recommendations"
      purpose="Automatic bundle generation: whether it runs, how often, and which products it may use."
      plan="Plan 2 (config endpoint) and Plan 4 (admin screens)"
      controls={[
        'Automatic recommendations on/off — off by default, so a new install spends no OpenAI budget until opted in',
        'Number of recommended products per bundle (1–10)',
        'Sync frequency: daily or weekly, with the UTC hour and weekday it runs',
        'Products excluded from bundle generation',
        'Products where the storefront widget is suppressed',
      ]}
    />
  );
}
