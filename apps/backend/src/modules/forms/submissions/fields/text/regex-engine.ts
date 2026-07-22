import RE2 from 're2';

/**
 * RE2-backed matching for merchant-authored `pattern`s (P1-1 ReDoS fix).
 *
 * Merchant patterns run against shopper input on the UNAUTHENTICATED public
 * submit path. Native `RegExp` backtracks, so an overlapping-alternation shape
 * like `(a|a)+$`, `(a|ab)+$`, or `(.*a){20}` explores ~2^n paths on a ~40-char
 * near-match input and pins the shared multi-tenant event loop (platform-wide
 * DoS). The save-time backtracking lint cannot catch those shapes and the
 * input-length cap does not help against exponential blowup.
 *
 * RE2 executes in linear time with NO backtracking, so a pathological pattern
 * can never run long — this is the real fix, not just a mitigation. RE2 covers
 * the features forms need (character classes, quantifiers, anchors,
 * alternation, named/non-capturing groups); features it cannot run
 * (backreferences, lookaround) throw at compile time and are rejected at save
 * time (shared `regexPatternSchema`).
 */

type CompiledPattern = InstanceType<typeof RE2>;

/** Compile a pattern with RE2. Returns null when RE2 cannot compile it. */
export function compilePattern(pattern: string): CompiledPattern | null {
  try {
    return new RE2(pattern);
  } catch {
    return null;
  }
}

/**
 * Linear-time, backtracking-immune test. Fails closed: a pattern RE2 cannot
 * compile never matches (such patterns are rejected at save time; a stored
 * incompatible pattern then rejects submissions rather than running a native
 * regex or throwing).
 */
export function matchesPattern(pattern: string, value: string): boolean {
  const re = compilePattern(pattern);
  return re !== null && re.test(value);
}
