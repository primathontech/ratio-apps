// Numeric canonicalization for the number field's render (blur normalize) and
// validate (tolerant parse). The implementation is the shared, Zod-free
// canonicalizer in `@ratio-app/shared` so the SDK and the backend validator
// agree exactly; this module just re-exports it under the SDK's local path.
export {
  canonicalizeNumber,
  localeSeparators,
  numericValue,
} from '@ratio-app/shared/schemas/fields/number/constants';
