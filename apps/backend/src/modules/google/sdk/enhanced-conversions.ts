import { createHash } from 'node:crypto';

/**
 * Raw, unhashed PII accepted by {@link buildUserData}. Every field is optional;
 * absent / empty fields are omitted from the hashed output entirely.
 */
export interface EnhancedConversionsInput {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
}

/** Hashed / normalized user_data payload for gtag('set', 'user_data', {...}). */
export interface EnhancedConversionsUserData {
  email?: string;
  phone_number?: string;
  first_name?: string;
  last_name?: string;
  street?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  /** Plaintext (NOT hashed) ISO 3166-1 alpha-2, uppercased. */
  country?: string;
}

/** SHA-256 hash of `value`, returned as lowercase hex. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Trim + lowercase, then SHA-256. */
function hashNormalized(value: string): string {
  return sha256(value.trim().toLowerCase());
}

/**
 * Normalize a phone number to an E.164-ish form: keep only digits and a single
 * leading '+', dropping every other character.
 */
function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Build the hashed/normalized `user_data` object for Google Ads enhanced
 * conversions from raw PII.
 *
 * All PII fields are SHA-256 hashed (lowercase hex) after trim + lowercase,
 * except `country`, which stays plaintext and is uppercased to ISO 3166-1
 * alpha-2. Any field that is null/undefined/empty-after-trim is omitted from
 * the output — an empty string is never hashed.
 *
 * @param input Partial raw PII.
 * @returns Object suitable for `gtag('set', 'user_data', {...})`.
 */
export function buildUserData(input: EnhancedConversionsInput): EnhancedConversionsUserData {
  const out: EnhancedConversionsUserData = {};

  const email = input.email?.trim();
  if (email) out.email = sha256(email.toLowerCase());

  const phone = input.phone?.trim();
  if (phone) {
    const normalized = normalizePhone(phone);
    if (normalized && normalized !== '+') out.phone_number = sha256(normalized);
  }

  const firstName = input.firstName?.trim();
  if (firstName) out.first_name = hashNormalized(firstName);

  const lastName = input.lastName?.trim();
  if (lastName) out.last_name = hashNormalized(lastName);

  const street = input.street?.trim();
  if (street) out.street = hashNormalized(street);

  const city = input.city?.trim();
  if (city) out.city = hashNormalized(city);

  const state = input.state?.trim();
  if (state) out.region = hashNormalized(state);

  const zipCode = input.zipCode?.trim();
  if (zipCode) out.postal_code = hashNormalized(zipCode);

  const country = input.country?.trim();
  if (country) out.country = country.toUpperCase();

  return out;
}
