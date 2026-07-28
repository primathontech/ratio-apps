/**
 * The single JSON-column parse helper for the backend. mysql2 hands JSON
 * columns back either already-parsed (an object/array) or as a raw string
 * depending on driver/connection flags, so both are accepted; a string is
 * `JSON.parse`d. ONE behavior everywhere: malformed JSON THROWS a clear,
 * PII-free error (never silently returns null). A caller that must tolerate a
 * corrupt row catches the throw at its own boundary (e.g. the delivery
 * executors dead-letter it) rather than each parse site inventing its own
 * swallow-or-throw policy.
 */

/** Parse a NOT-NULL JSON column into `T`; throws on null/undefined or malformed JSON. */
export function parseJsonColumn<T>(raw: T | string | null | undefined): T {
  if (raw === null || raw === undefined) {
    throw new Error('cannot parse JSON column: value is null or undefined');
  }
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Never echo `raw` — a JSON column can hold submission PII.
    throw new Error('malformed JSON in database column');
  }
}

/** Nullable twin: null/undefined → null; a malformed string still THROWS. */
export function parseJsonColumnOrNull<T>(raw: T | string | null | undefined): T | null {
  if (raw === null || raw === undefined) return null;
  return parseJsonColumn<T>(raw);
}
