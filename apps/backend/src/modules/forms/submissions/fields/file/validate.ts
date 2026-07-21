import type { FormField } from '@ratio-app/shared/schemas/form-schema';

type FileField = Extract<FormField, { type: 'file' }>;

/**
 * File fields arrive as pre-uploaded S3 object keys in `files`. The key
 * MUST live under this merchant+form's prefix — a key from another
 * merchant's (or form's) prefix is rejected outright (TDD §3.6).
 */
export function validateFile(
  field: FileField,
  objectKey: string | undefined,
  scope: { merchantId: string; formId: string },
): string | null {
  if (objectKey === undefined || objectKey === '') {
    return field.required ? 'a file is required' : null;
  }
  if (typeof objectKey !== 'string') return 'must be an uploaded file key';
  if (!objectKey.startsWith(`${scope.merchantId}/${scope.formId}/`)) {
    return 'file does not belong to this form';
  }
  return null;
}
