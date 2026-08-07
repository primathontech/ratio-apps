import { CLEVERTAP_WEBHOOK_EVENT_NAMES } from '@ratio-app/shared/constants/clevertap-events';
import {
  buildIdempotencyKey,
  type MappedClevertapEvent,
  normalizeIndianPhone,
} from './order-event.mapper';

export const REVIEW_UNMAPPABLE_NO_ID = 'payload has no review id';

export const REVIEW_UNMAPPABLE_NO_IDENTITY =
  'payload has no phone, email or customer id — CleverTap requires an identity (523)';

export interface UnmappableReview {
  subjectId: string | null;
  reason: string;
}

export function deriveReviewEventName(topic: string): string {
  const known = (CLEVERTAP_WEBHOOK_EVENT_NAMES as Record<string, string | undefined>)[topic];
  return known ?? 'Review Submitted';
}

export function mapReviewEvent(
  topic: string,
  review: Record<string, unknown>,
): MappedClevertapEvent | null {
  const reviewId = extractReviewId(review);
  if (!reviewId) return null;

  const identity = deriveReviewIdentity(review);
  if (!identity) return null;

  const clevertapEvent = deriveReviewEventName(topic);

  const evtData: Record<string, unknown> = { 'Review ID': reviewId };

  const rating = toFiniteNumber(review.rating ?? review.score ?? review.stars);
  if (rating !== null) evtData.Rating = rating;

  const product = asRecord(review.product);
  const productId = firstString(review.product_id, product.id, review.productId);
  if (productId) evtData['Product ID'] = productId;

  const productTitle = firstString(
    review.product_title,
    review.product_name,
    product.title,
    product.name,
    review.productTitle,
  );
  if (productTitle) evtData['Product name'] = productTitle;

  const ts = toUnixSeconds(review.updated_at ?? review.created_at);

  return {
    clevertapEvent,
    subjectId: reviewId,
    records: [
      {
        identity,
        type: 'event',
        evtName: clevertapEvent,
        evtData,
        ...(ts !== null ? { ts } : {}),
      },
    ],
  };
}

export function describeUnmappableReview(review: Record<string, unknown>): UnmappableReview {
  const subjectId = extractReviewId(review);
  return {
    subjectId,
    reason: subjectId === null ? REVIEW_UNMAPPABLE_NO_ID : REVIEW_UNMAPPABLE_NO_IDENTITY,
  };
}

export { buildIdempotencyKey };

function deriveReviewIdentity(review: Record<string, unknown>): string | null {
  const customer = asRecord(review.customer);
  const reviewer = asRecord(review.reviewer);
  return (
    normalizeIndianPhone(review.phone) ??
    normalizeIndianPhone(customer.phone) ??
    normalizeIndianPhone(reviewer.phone) ??
    extractEmail(review) ??
    extractEmail(customer) ??
    extractEmail(reviewer) ??
    firstString(review.customer_id) ??
    firstString(customer.id) ??
    firstString(reviewer.id)
  );
}

function extractReviewId(review: Record<string, unknown>): string | null {
  return firstString(review.id, review.review_id, review.reviewId);
}

function extractEmail(resource: Record<string, unknown>): string | null {
  const email = typeof resource.email === 'string' ? resource.email.trim() : '';
  return email ? email.toLowerCase() : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c.trim();
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toUnixSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.floor(v > 1e11 ? v / 1000 : v);
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
  }
  return null;
}
