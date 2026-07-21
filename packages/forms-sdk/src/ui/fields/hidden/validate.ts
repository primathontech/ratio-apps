import type { ControlFieldOf, FieldValidateCtx } from '../types';

/** Hidden fields are populated from the URL, never shown; no user validation. */
export function validateHidden(
  _field: ControlFieldOf<'hidden'>,
  _ctx: FieldValidateCtx,
): string | null {
  return null;
}
