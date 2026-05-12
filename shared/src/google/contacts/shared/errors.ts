// Error classes for the Google Contacts read-only sync layer.
// These are thrown by defense-layer guards (L2.1, L2.2, L1.2) and by the pull engine.
//
// EDITING RULES:
// - Do NOT remove or weaken any error class — each maps to a hard invariant (see spec §7).
// - Do NOT add write-related error variants without a spec amendment.
// - All comments must remain in English.

// RO-INVARIANT: L2.1, L2.2, L1.2

/** Thrown when a non-GET HTTP method is attempted (L2.1: HTTP method whitelist). */
export class ReadOnlyViolationError extends Error {
  override name = 'ReadOnlyViolationError'

  constructor(attemptedMethod: string) {
    super(
      `Read-only violation: attempted HTTP method "${attemptedMethod}" is not allowed. Only GET is permitted.`,
    )
  }
}

/** Thrown when a URL does not match the allowed People API patterns (L2.2: URL allowlist). */
export class UrlAllowlistViolationError extends Error {
  override name = 'UrlAllowlistViolationError'

  constructor(attemptedUrl: string) {
    super(`URL allowlist violation: "${attemptedUrl}" is not in the permitted URL patterns.`)
  }
}

/** Thrown when granted OAuth scope does not exactly match the required read-only scope (L1.2). */
export class ScopeViolationError extends Error {
  override name = 'ScopeViolationError'

  constructor(message: string) {
    super(message)
  }
}

/** Thrown to represent a pull operation failure surfaced to the UI. */
export class PullError extends Error {
  override name = 'PullError'

  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message)
  }
}
