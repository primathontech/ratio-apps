import {
  FORM_FILE_ALLOWED_MIME_TYPES,
  type FormFileAllowedMimeType,
} from '@ratio-app/shared/schemas/form-schema';

/**
 * Bytes to read off the head of an object to identify it (P2-3): the longest
 * signature we match is WEBP's `RIFF....WEBP` (12 bytes), so 16 is a small,
 * round window that covers every accepted type with room to spare.
 */
export const FILE_SNIFF_BYTES = 16;

/**
 * A fixed-position byte segment that must appear verbatim at `offset` for a
 * signature to match. Signatures are lists of segments so a container format
 * (WEBP) can pin its `RIFF` tag and `WEBP` FourCC while SKIPPING the 4-byte
 * little-endian chunk size that sits between them.
 */
interface MagicSegment {
  readonly offset: number;
  readonly bytes: readonly number[];
}

interface MagicSignature {
  readonly mime: FormFileAllowedMimeType;
  readonly segments: readonly MagicSegment[];
}

/**
 * Magic-number table for exactly the platform-accepted upload types
 * ({@link FORM_FILE_ALLOWED_MIME_TYPES}). Kept as a hand-rolled table rather
 * than a dependency (`file-type`) because the accepted set is tiny and closed —
 * four signatures with no ambiguity — so the extra bytes/attack surface of a
 * general-purpose sniffer buys nothing here.
 */
const MAGIC_SIGNATURES: readonly MagicSignature[] = [
  // JPEG: SOI marker FF D8 then a marker start FF.
  { mime: 'image/jpeg', segments: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  // PNG: 8-byte signature (\x89 P N G \r \n \x1a \n).
  {
    mime: 'image/png',
    segments: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  // WEBP: "RIFF" container, a 4-byte size we skip, then the "WEBP" FourCC.
  {
    mime: 'image/webp',
    segments: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
    ],
  },
  // PDF: "%PDF" header.
  { mime: 'application/pdf', segments: [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }] },
];

/**
 * Identify a buffer by its magic bytes, restricted to the accepted upload
 * types. Returns the detected MIME, or `null` when the head matches no known
 * signature (empty/truncated/unknown bytes) — callers treat `null` as "reject",
 * so the check fails closed.
 */
export function sniffContentType(bytes: Uint8Array): FormFileAllowedMimeType | null {
  for (const sig of MAGIC_SIGNATURES) {
    const matches = sig.segments.every((seg) =>
      seg.bytes.every((b, i) => bytes[seg.offset + i] === b),
    );
    if (matches) return sig.mime;
  }
  return null;
}

/**
 * Byte-level content-type check (P2-3): a caller can declare `image/png` on the
 * presign and then PUT arbitrary bytes (an executable, a PDF) — S3 only signs
 * the DECLARED type, never inspects the payload. Sniff the real type from the
 * head bytes and reject when it isn't in this field's allowlist. Returns a
 * user-facing error string (same shape as {@link validateFile}), or `null` when
 * the bytes genuinely match an allowed type.
 */
export function validateFileType(
  allowedMimeTypes: readonly string[],
  bytes: Uint8Array,
): string | null {
  const sniffed = sniffContentType(bytes);
  if (sniffed === null || !allowedMimeTypes.includes(sniffed)) {
    return 'This file type is not allowed.';
  }
  return null;
}

// Re-exported so the wiring site can fall back to the platform allowlist for a
// field that pins no `allowedMimeTypes` of its own.
export { FORM_FILE_ALLOWED_MIME_TYPES };
