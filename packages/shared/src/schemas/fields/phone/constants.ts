/**
 * Phone country metadata + pure phone-number helpers — DELIBERATELY ZOD-FREE.
 *
 * The storefront SDK (`packages/forms-sdk`) imports these at RUNTIME to render
 * the dial-code selector and to validate/compose numbers, so this module must
 * never pull Zod into the widget bundle. It mirrors the `form-adornments.ts`
 * zero-Zod posture. The field's `schema.ts` re-imports the constants below to
 * build its enum + refinements (Zod is fine there — schema.ts is never bundled
 * into the widget).
 *
 * Security envelope: countries are a closed enum, dial codes come from this
 * curated table (never merchant input), and national-number length checks are
 * bounded integers. No user-supplied regex is ever constructed here.
 */

export interface PhoneCountryMeta {
  /** Display name of the country. */
  name: string;
  /** E.164 country calling code including the leading '+', e.g. '+91'. */
  dial: string;
  /** Flag emoji shown in the selector option. */
  flag: string;
  /** Minimum national (subscriber) number length, digits only. */
  minLength: number;
  /** Maximum national number length, digits only. */
  maxLength: number;
  /** Placeholder hint for the national-number input. */
  placeholder: string;
}

/**
 * Curated country table. National-length bounds are pragmatic sanity ranges
 * (not an exhaustive numbering-plan validator) — they exist to reject obviously
 * malformed input, not to guarantee a live subscriber. `IN` is kept exactly
 * `+91` / 10 digits / '10-digit number' so the default (unconfigured) phone
 * field stays byte-identical to v1.
 */
export const PHONE_COUNTRY_META = {
  IN: {
    name: 'India',
    dial: '+91',
    flag: '🇮🇳',
    minLength: 10,
    maxLength: 10,
    placeholder: '10-digit number',
  },
  US: {
    name: 'United States',
    dial: '+1',
    flag: '🇺🇸',
    minLength: 10,
    maxLength: 10,
    placeholder: '(201) 555-0123',
  },
  CA: {
    name: 'Canada',
    dial: '+1',
    flag: '🇨🇦',
    minLength: 10,
    maxLength: 10,
    placeholder: '(506) 555-0123',
  },
  GB: {
    name: 'United Kingdom',
    dial: '+44',
    flag: '🇬🇧',
    minLength: 9,
    maxLength: 10,
    placeholder: '7400 123456',
  },
  AU: {
    name: 'Australia',
    dial: '+61',
    flag: '🇦🇺',
    minLength: 9,
    maxLength: 9,
    placeholder: '412 345 678',
  },
  NZ: {
    name: 'New Zealand',
    dial: '+64',
    flag: '🇳🇿',
    minLength: 8,
    maxLength: 10,
    placeholder: '21 123 4567',
  },
  AE: {
    name: 'United Arab Emirates',
    dial: '+971',
    flag: '🇦🇪',
    minLength: 8,
    maxLength: 9,
    placeholder: '50 123 4567',
  },
  SG: {
    name: 'Singapore',
    dial: '+65',
    flag: '🇸🇬',
    minLength: 8,
    maxLength: 8,
    placeholder: '8123 4567',
  },
  DE: {
    name: 'Germany',
    dial: '+49',
    flag: '🇩🇪',
    minLength: 7,
    maxLength: 11,
    placeholder: '1512 3456789',
  },
  FR: {
    name: 'France',
    dial: '+33',
    flag: '🇫🇷',
    minLength: 9,
    maxLength: 9,
    placeholder: '6 12 34 56 78',
  },
  ES: {
    name: 'Spain',
    dial: '+34',
    flag: '🇪🇸',
    minLength: 9,
    maxLength: 9,
    placeholder: '612 34 56 78',
  },
  IT: {
    name: 'Italy',
    dial: '+39',
    flag: '🇮🇹',
    minLength: 9,
    maxLength: 10,
    placeholder: '312 345 6789',
  },
  BR: {
    name: 'Brazil',
    dial: '+55',
    flag: '🇧🇷',
    minLength: 10,
    maxLength: 11,
    placeholder: '11 91234 5678',
  },
  ZA: {
    name: 'South Africa',
    dial: '+27',
    flag: '🇿🇦',
    minLength: 9,
    maxLength: 9,
    placeholder: '71 123 4567',
  },
  NG: {
    name: 'Nigeria',
    dial: '+234',
    flag: '🇳🇬',
    minLength: 8,
    maxLength: 10,
    placeholder: '802 123 4567',
  },
  SA: {
    name: 'Saudi Arabia',
    dial: '+966',
    flag: '🇸🇦',
    minLength: 9,
    maxLength: 9,
    placeholder: '51 234 5678',
  },
  PK: {
    name: 'Pakistan',
    dial: '+92',
    flag: '🇵🇰',
    minLength: 10,
    maxLength: 10,
    placeholder: '301 2345678',
  },
  BD: {
    name: 'Bangladesh',
    dial: '+880',
    flag: '🇧🇩',
    minLength: 10,
    maxLength: 10,
    placeholder: '1812 345678',
  },
  LK: {
    name: 'Sri Lanka',
    dial: '+94',
    flag: '🇱🇰',
    minLength: 9,
    maxLength: 9,
    placeholder: '71 234 5678',
  },
  NP: {
    name: 'Nepal',
    dial: '+977',
    flag: '🇳🇵',
    minLength: 10,
    maxLength: 10,
    placeholder: '98 1234 5678',
  },
  JP: {
    name: 'Japan',
    dial: '+81',
    flag: '🇯🇵',
    minLength: 10,
    maxLength: 11,
    placeholder: '90 1234 5678',
  },
  CN: {
    name: 'China',
    dial: '+86',
    flag: '🇨🇳',
    minLength: 11,
    maxLength: 11,
    placeholder: '131 2345 6789',
  },
  KR: {
    name: 'South Korea',
    dial: '+82',
    flag: '🇰🇷',
    minLength: 9,
    maxLength: 10,
    placeholder: '10 1234 5678',
  },
  ID: {
    name: 'Indonesia',
    dial: '+62',
    flag: '🇮🇩',
    minLength: 9,
    maxLength: 12,
    placeholder: '812 3456 789',
  },
  MY: {
    name: 'Malaysia',
    dial: '+60',
    flag: '🇲🇾',
    minLength: 9,
    maxLength: 10,
    placeholder: '12 345 6789',
  },
  TH: {
    name: 'Thailand',
    dial: '+66',
    flag: '🇹🇭',
    minLength: 9,
    maxLength: 9,
    placeholder: '81 234 5678',
  },
  PH: {
    name: 'Philippines',
    dial: '+63',
    flag: '🇵🇭',
    minLength: 10,
    maxLength: 10,
    placeholder: '917 123 4567',
  },
  VN: {
    name: 'Vietnam',
    dial: '+84',
    flag: '🇻🇳',
    minLength: 9,
    maxLength: 10,
    placeholder: '91 234 56 78',
  },
  TR: {
    name: 'Türkiye',
    dial: '+90',
    flag: '🇹🇷',
    minLength: 10,
    maxLength: 10,
    placeholder: '501 234 56 78',
  },
  RU: {
    name: 'Russia',
    dial: '+7',
    flag: '🇷🇺',
    minLength: 10,
    maxLength: 10,
    placeholder: '912 345-67-89',
  },
  MX: {
    name: 'Mexico',
    dial: '+52',
    flag: '🇲🇽',
    minLength: 10,
    maxLength: 10,
    placeholder: '222 123 4567',
  },
  AR: {
    name: 'Argentina',
    dial: '+54',
    flag: '🇦🇷',
    minLength: 10,
    maxLength: 11,
    placeholder: '11 2345-6789',
  },
  NL: {
    name: 'Netherlands',
    dial: '+31',
    flag: '🇳🇱',
    minLength: 9,
    maxLength: 9,
    placeholder: '6 12345678',
  },
  SE: {
    name: 'Sweden',
    dial: '+46',
    flag: '🇸🇪',
    minLength: 7,
    maxLength: 9,
    placeholder: '70 123 45 67',
  },
  CH: {
    name: 'Switzerland',
    dial: '+41',
    flag: '🇨🇭',
    minLength: 9,
    maxLength: 9,
    placeholder: '78 123 45 67',
  },
  IE: {
    name: 'Ireland',
    dial: '+353',
    flag: '🇮🇪',
    minLength: 7,
    maxLength: 9,
    placeholder: '85 123 4567',
  },
  PT: {
    name: 'Portugal',
    dial: '+351',
    flag: '🇵🇹',
    minLength: 9,
    maxLength: 9,
    placeholder: '912 345 678',
  },
  PL: {
    name: 'Poland',
    dial: '+48',
    flag: '🇵🇱',
    minLength: 9,
    maxLength: 9,
    placeholder: '512 345 678',
  },
  EG: {
    name: 'Egypt',
    dial: '+20',
    flag: '🇪🇬',
    minLength: 10,
    maxLength: 10,
    placeholder: '100 123 4567',
  },
  KE: {
    name: 'Kenya',
    dial: '+254',
    flag: '🇰🇪',
    minLength: 9,
    maxLength: 9,
    placeholder: '712 345678',
  },
} as const satisfies Record<string, PhoneCountryMeta>;

/** ISO-3166 alpha-2 codes present in the table — the closed enum of countries. */
export type PhoneCountryCode = keyof typeof PHONE_COUNTRY_META;

/** Non-empty tuple of country codes for `z.enum(...)` and the admin selectors. */
export const PHONE_COUNTRY_CODES = Object.keys(PHONE_COUNTRY_META) as [
  PhoneCountryCode,
  ...PhoneCountryCode[],
];

/** Implicit default country when a field carries no country config (v1 parity). */
export const DEFAULT_PHONE_COUNTRY: PhoneCountryCode = 'IN';

/** Type guard: is `code` a known country in the table. */
export function isPhoneCountryCode(code: string): code is PhoneCountryCode {
  return Object.hasOwn(PHONE_COUNTRY_META, code);
}

/**
 * Resolve the effective country set + default for a field, from its optional
 * `countries.allowed` / `countries.default` config. Unknown codes are dropped;
 * an empty/absent allow-list collapses to `[default ?? IN]`. Guarantees a
 * non-empty list and a default that is a member of it.
 */
export function resolvePhoneCountries(
  allowed: readonly string[] | undefined,
  fallbackDefault: string | undefined,
): { codes: PhoneCountryCode[]; defaultCode: PhoneCountryCode } {
  const filtered = (allowed ?? []).filter(isPhoneCountryCode);
  const def =
    fallbackDefault && isPhoneCountryCode(fallbackDefault)
      ? fallbackDefault
      : DEFAULT_PHONE_COUNTRY;
  const codes = filtered.length > 0 ? filtered : [def];
  const defaultCode = codes.includes(def) ? def : (codes[0] as PhoneCountryCode);
  return { codes, defaultCode };
}

// Formatting characters a shopper may type between digits (spaces, dashes,
// dots, parens). Stripped before any length/format check. Bounded, static.
const PHONE_SEPARATOR_RE = /[\s\-().]/g;

/** Strip human separators; normalize a leading `00` international prefix to `+`. */
export function normalizePhoneInput(raw: string): string {
  const compact = raw.replace(PHONE_SEPARATOR_RE, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}

/**
 * Split a stored phone value into its selected country + national digits, for
 * RE-RENDERING the composite control. Lenient (no length enforcement): used to
 * pre-select the dial-code and populate the number input. A leading `+dial`
 * that matches an allowed country wins (longest dial preferred); otherwise the
 * value is treated as a national number under `defaultCode`.
 */
export function splitPhoneValue(
  raw: unknown,
  codes: readonly PhoneCountryCode[],
  defaultCode: PhoneCountryCode,
): { code: PhoneCountryCode; national: string } {
  const s = normalizePhoneInput(String(raw ?? ''));
  if (s.startsWith('+')) {
    const matches = codes
      .filter((c) => s.startsWith(PHONE_COUNTRY_META[c].dial))
      .sort((a, b) => PHONE_COUNTRY_META[b].dial.length - PHONE_COUNTRY_META[a].dial.length);
    const code = matches[0];
    if (code) {
      return { code, national: s.slice(PHONE_COUNTRY_META[code].dial.length).replace(/\D/g, '') };
    }
  }
  return { code: defaultCode, national: s.replace(/\D/g, '') };
}

/** Compose a canonical E.164 value from a country + national digits. */
export function composePhoneValue(code: PhoneCountryCode, national: string): string {
  return `${PHONE_COUNTRY_META[code].dial}${national.replace(/\D/g, '')}`;
}

export type PhoneCanonicalResult = { value: string } | { empty: true } | { error: true };

/**
 * SERVER/CLIENT-shared canonicalizer — the single source of truth both the SDK
 * client validator and the backend server validator call, so verdicts never
 * drift. Determines the country (leading `+dial` among `codes`, else
 * `defaultCode`), then enforces that the national part is digits-only and
 * within that country's length bounds. Returns:
 *  - `{ value }`  canonical `+<dial><national>` when valid,
 *  - `{ empty }`  when only a dial code (no national digits) is present — the
 *                 caller applies its required/optional rule,
 *  - `{ error }`  when the dial is not allowed or the length/charset is wrong.
 */
export function canonicalizePhone(
  raw: unknown,
  codes: readonly PhoneCountryCode[],
  defaultCode: PhoneCountryCode,
): PhoneCanonicalResult {
  if (typeof raw !== 'string') return { error: true };
  const s = normalizePhoneInput(raw);
  let code: PhoneCountryCode;
  let national: string;
  if (s.startsWith('+')) {
    const candidates = codes
      .filter((c) => s.startsWith(PHONE_COUNTRY_META[c].dial))
      .sort((a, b) => PHONE_COUNTRY_META[b].dial.length - PHONE_COUNTRY_META[a].dial.length);
    if (candidates.length === 0) return { error: true };
    // Prefer a candidate whose national part fits its bounds (disambiguates
    // shared dials like +1 US/CA); otherwise take the longest-dial match.
    const fitting = candidates.find((c) => {
      const nat = s.slice(PHONE_COUNTRY_META[c].dial.length);
      const m = PHONE_COUNTRY_META[c];
      return /^[0-9]+$/.test(nat) && nat.length >= m.minLength && nat.length <= m.maxLength;
    });
    code = fitting ?? (candidates[0] as PhoneCountryCode);
    national = s.slice(PHONE_COUNTRY_META[code].dial.length);
  } else {
    code = defaultCode;
    national = s;
  }
  if (national.length === 0) return { empty: true };
  const meta = PHONE_COUNTRY_META[code];
  if (!/^[0-9]+$/.test(national)) return { error: true };
  if (national.length < meta.minLength || national.length > meta.maxLength) return { error: true };
  return { value: `${meta.dial}${national}` };
}

/**
 * Human error string for an invalid number. When a single country is in play
 * and it has a fixed length, we surface the exact digit count (keeps the v1
 * IN message "…valid 10-digit phone number."); otherwise a generic message.
 */
export function phoneErrorMessage(
  codes: readonly PhoneCountryCode[],
  defaultCode: PhoneCountryCode,
): string {
  if (codes.length === 1) {
    const meta = PHONE_COUNTRY_META[codes[0] as PhoneCountryCode];
    if (meta.minLength === meta.maxLength) {
      return `Please enter a valid ${meta.minLength}-digit phone number.`;
    }
  }
  void defaultCode;
  return 'Please enter a valid phone number.';
}
