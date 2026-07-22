import { Inject, Injectable } from '@nestjs/common';
import type { KyselyClient } from '../../../core/db/kysely-factory';
import type { FormsDatabase } from '../db/types';
import { FORMS_DB_TOKEN } from '../kysely.module';

/** Minimal form identity the embed page needs (merchant to load the SDK, name for the title). */
export interface EmbedForm {
  merchantId: string;
  name: string;
}

/** Escape untrusted text (the form name) before it lands in HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serves the self-contained iframe embed page (`GET /forms/embed/:formId`).
 *
 * The PRD promises a drop-in iframe so a merchant can embed a form into ANY
 * existing page without adding a route to their own repo:
 *   <iframe src="<publicBackend>/forms/embed/<formId>"></iframe>
 *
 * The page mounts the same storefront SDK the `<script>` embed uses, but the
 * SDK src is RELATIVE (`/forms/sdk/<merchantId>.js`) because this page is
 * served from the SAME backend origin as the SDK (unlike the merchant
 * storefront, where the SDK needs an absolute base).
 */
@Injectable()
export class FormsEmbedService {
  constructor(@Inject(FORMS_DB_TOKEN) private readonly handle: KyselyClient<FormsDatabase>) {}

  /**
   * Resolve the merchant + name from a form id. Soft-deleted forms are hidden.
   * Status is deliberately NOT gated: the SDK renders the "form closed" state
   * for inactive forms, so the embed page should still load. Returns null when
   * the form id does not exist.
   */
  async resolve(formId: string): Promise<EmbedForm | null> {
    const form = await this.handle.db
      .selectFrom('forms')
      .select(['merchantId', 'name'])
      .where('id', '=', formId)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (!form) return null;
    return { merchantId: form.merchantId, name: form.name };
  }

  /** The full iframe-able HTML page: reset, responsive wrapper, mount div, SDK. */
  renderPage(formId: string, form: EmbedForm): string {
    const title = escapeHtml(form.name);
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
html,body{margin:0}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111;background:transparent;padding:16px}
.ratio-embed{max-width:640px;margin:0 auto}
</style>
</head>
<body>
<div class="ratio-embed"><div data-ratio-form="${formId}"></div></div>
<script src="/forms/sdk/${form.merchantId}.js" defer></script>
</body>
</html>`;
  }

  /** Minimal 404 page for an unknown form id (still HTML, never a JSON error). */
  renderNotFound(): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Form not available</title>
<style>
html,body{margin:0}
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#444;padding:24px}
.ratio-embed{max-width:640px;margin:0 auto}
</style>
</head>
<body>
<div class="ratio-embed"><p>This form is not available.</p></div>
</body>
</html>`;
  }
}
