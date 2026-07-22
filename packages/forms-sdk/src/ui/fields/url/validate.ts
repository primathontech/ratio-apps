import { type ControlFieldOf, type FieldValidateCtx, isEmpty } from '../types';

const URL_RE = /^https?:\/\/[^\s.]+\.[^\s]+$/i;

export function validateUrl(field: ControlFieldOf<'url'>, ctx: FieldValidateCtx): string | null {
  const value = ctx.values[field.key];
  if (isEmpty(value)) return field.required ? 'this field is required' : null;
  return URL_RE.test(String(value)) ? null : 'must be a valid URL';
}
