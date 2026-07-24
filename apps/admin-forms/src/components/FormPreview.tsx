import { Segmented } from '@primathonos/orion';
import type { FormAppearance, FormField } from '@shared/schemas/form-schema';
import { useEffect, useRef, useState } from 'react';
// Embed the REAL storefront renderer so the preview and the SDK embed can never
// drift: there is now one renderer, driven here by the SDK's inline preview
// props. The `?sdk` side-effect import registers `<ratio-form>` and pulls the
// element source through Vite (built under the SDK's own decorator tsconfig);
// see forms-sdk-embed.d.ts for why the query suffix is required.
import '../../../../packages/forms-sdk/src/ui/form-renderer?sdk';

/** Screens the SDK preview mode can show (mirrors the SDK's `PreviewState`). */
export type PreviewState = 'ready' | 'success' | 'error' | 'closed';

/** The inline preview API the `<ratio-form>` element exposes (JS props only). */
interface RatioFormElement extends HTMLElement {
  previewSchema: FormField[] | null;
  previewAppearance: FormAppearance | undefined;
  previewName: string;
  previewDescription: string;
  previewSubmitLabel: string;
  previewSuccessMessage: string;
  previewState: PreviewState;
}

interface Props {
  name: string;
  fields: FormField[];
  /** Submit button label; forwarded to the SDK preview (defaults when unset). */
  submitLabel?: string;
  /** Success/ending message; forwarded to the SDK preview (defaults when unset). */
  successMessage?: string;
  /** Optional subtitle shown under the title. */
  description?: string | undefined;
  /** Absent = un-themed; the SDK's baked-in defaults are used. */
  appearance?: FormAppearance | undefined;
  /** 375px mobile frame vs a wide desktop frame (up to 680px, centered). */
  mode: 'mobile' | 'desktop';
}

/** Max render width of the desktop frame; a realistic form column, not the panel edge. */
const DESKTOP_MAX_WIDTH = 680;

const STATE_OPTIONS: { label: string; value: PreviewState }[] = [
  { label: 'Ready', value: 'ready' },
  { label: 'Success', value: 'success' },
  { label: 'Error', value: 'error' },
  { label: 'Closed', value: 'closed' },
];

/**
 * Live preview of the CURRENT builder schema, rendered by the actual storefront
 * `<ratio-form>` element in its inline preview mode. Feeding it the builder's
 * schema/appearance/name/description means the merchant sees exactly what the
 * embed will produce — same tokens, fonts, rating fill, button shape, label
 * layout, and @container responsiveness — with no hand-maintained duplicate.
 *
 * The state control lets the merchant preview each screen the SDK ships (the
 * fillable form, the themed success ending, validation error rings, and the
 * closed box) before publishing. Submit runs client validation only; it never
 * POSTs while in preview.
 */
export function FormPreview({
  name,
  fields,
  submitLabel,
  successMessage,
  description,
  appearance,
  mode,
}: Props) {
  const [state, setState] = useState<PreviewState>('ready');
  const hostRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<RatioFormElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let el = elRef.current;
    if (!el) {
      el = document.createElement('ratio-form') as RatioFormElement;
      el.style.width = '100%';
      elRef.current = el;
    }
    // Attach once; re-attach only if a remount handed us a fresh host node.
    if (el.parentElement !== host) host.appendChild(el);
    el.previewName = name;
    el.previewDescription = description ?? '';
    el.previewSubmitLabel = submitLabel ?? '';
    el.previewSuccessMessage = successMessage ?? '';
    el.previewAppearance = appearance;
    el.previewState = state;
    // Set the schema last so the reactive update sees a complete config; a
    // non-null value is what switches the element into preview mode.
    el.previewSchema = fields;
  }, [name, description, submitLabel, successMessage, appearance, state, fields]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Segmented
        aria-label="Preview state"
        size="small"
        options={STATE_OPTIONS}
        value={state}
        onChange={(value) => setState(value as PreviewState)}
      />
      <div
        ref={hostRef}
        data-testid={`preview-${mode}`}
        style={{
          width: mode === 'mobile' ? 375 : '100%',
          maxWidth: mode === 'mobile' ? '100%' : DESKTOP_MAX_WIDTH,
          margin: '0 auto',
        }}
      />
    </div>
  );
}
