import { APPS, type AppSlug } from './config/apps';
import { GoogleModule } from './modules/google/google.module';
import { MetaModule } from './modules/meta/meta.module';
import { PosthogModule } from './modules/posthog/posthog.module';
import { MoengageModule } from './modules/moengage/moengage.module';
import { WizzyModule } from './modules/wizzy/wizzy.module';
import { RpModule } from './modules/rp/rp.module';
import { FormsModule } from './modules/forms/forms.module';

/** slug → module class. Source of truth for what CAN be mounted. */
export const MODULE_REGISTRY = new Map<AppSlug, unknown>([
  ['google', GoogleModule],
  ['meta', MetaModule],
  ['posthog', PosthogModule],
  ['moengage', MoengageModule],
  ['wizzy', WizzyModule],
  ['rp', RpModule],
  ['forms', FormsModule],
]);

for (const slug of APPS) {
  if (!MODULE_REGISTRY.has(slug)) {
    throw new Error(`MODULE_REGISTRY: APPS contains '${slug}' but no <App>Module is registered`);
  }
}
