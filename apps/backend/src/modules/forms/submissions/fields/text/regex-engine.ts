import RE2 from 're2';

/** RE2-backed matching for merchant `pattern`s on the unauthenticated public submit path (P1-1 ReDoS fix): native RegExp backtracks and a pathological shape can pin the shared multi-tenant event loop, whereas RE2 runs linear-time with no backtracking. Backreferences/lookaround throw at compile time and are rejected at save time. */

type CompiledPattern = InstanceType<typeof RE2>;

/** Compile a pattern with RE2. Returns null when RE2 cannot compile it. */
export function compilePattern(pattern: string): CompiledPattern | null {
  try {
    return new RE2(pattern);
  } catch {
    return null;
  }
}

/** Linear-time, backtracking-immune test; fails closed — a pattern RE2 can't compile never matches (rejected at save time, so a stored incompatible pattern rejects submissions rather than running a native regex). */
export function matchesPattern(pattern: string, value: string): boolean {
  const re = compilePattern(pattern);
  return re !== null && re.test(value);
}
