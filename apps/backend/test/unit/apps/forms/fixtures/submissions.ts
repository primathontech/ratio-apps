/**
 * Submission payload fixtures (TDD §7): a valid payload per fixture form,
 * the invalid matrix rows (PRD F4–F6, F11, F13), and the precomputed golden
 * idempotency digests (determinism, TDD §1).
 */

export const VALID_CONTACT_PAYLOAD = {
  fields: { name: 'Asha', email: 'asha@example.com', message: 'Hello there' },
};

export const VALID_KITCHEN_SINK_FIELDS = {
  name: 'Asha Rao',
  bio: 'Short bio',
  email: 'asha@example.com',
  phone: '9876543210',
  topic: 'sales',
  channels: ['email', 'sms'],
  visit_date: '2026-03-01',
};

export const VALID_KITCHEN_SINK_FILES = (merchantId: string, formId: string) => ({
  resume: `${merchantId}/${formId}/draft_abc/resume`,
});

/** Invalid rows: [description, fields overrides, expected failing key]. */
export const INVALID_MATRIX: Array<[string, Record<string, unknown>, string]> = [
  ['required empty (F4)', { name: '' }, 'name'],
  ['bad email (F5)', { email: 'not-an-email' }, 'email'],
  ['9-digit phone (F6)', { phone: '987654321' }, 'phone'],
  ['regex mismatch', { name: 'Asha123' }, 'name'],
  ['below minLength', { name: 'A' }, 'name'],
  ['textarea over max (F13)', { bio: 'x'.repeat(101) }, 'bio'],
  ['dropdown value not in options', { topic: 'gossip' }, 'topic'],
  ['multi_select value not in options', { channels: ['email', 'fax'] }, 'channels'],
  ['unparseable date', { visit_date: 'not-a-date' }, 'visit_date'],
];

/**
 * Golden digests: sha256(`${formId}:${sessionKey}:${floor(epochMs / 5000)}`)
 * precomputed for formId 'form_contact' — regressions in the key recipe
 * (separator, bucket size, encoding) fail loudly against these.
 */
export const GOLDEN_IDEMPOTENCY = {
  /** now = 1_400_000_000_000, session 'sess_1' (bucket 280000000). */
  session: '3ee81ab8d4c4db21d6675a87f6999dd4e4e21449c993ad77d7e45c8a7083aafa',
  /** now = 1_400_000_005_100, session 'sess_1' (next 5s bucket). */
  sessionNextBucket: '8481d8f497569e88409a15012d88e67524365ef4c2ba69f33a224c440be79aa6',
  /** now = 1_400_000_000_000, no session → IP '203.0.113.9'. */
  ipFallback: '4aa36935a220af79643772cb530b6f169cf5166c93a1b98608de484d64513e5b',
} as const;
