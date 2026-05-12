// Checks whether a previous OAuth consent is still considered fresh.
// Used to decide whether to skip the consent screen (prompt=consent always set, but
// this check gates whether we even initiate a new OAuth flow or reuse stored tokens).
//
// EDITING RULES:
// - Do NOT increase maxAgeDays default without a spec amendment (L7.2).
// - This function must remain pure (no side effects, no imports from Tauri layer).
// - All comments must remain in English.

// RO-INVARIANT: L7.2

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Returns true if the stored consent timestamp is within the allowed freshness window.
 *
 * @param latestConsentTs - ISO 8601 string of the most recent consent grant, or null if never consented.
 * @param now             - Current time reference (injected for testability).
 * @param maxAgeDays      - Maximum age in days before consent is considered stale (default: 90).
 */
export function isConsentFresh(
  latestConsentTs: string | null,
  now: Date,
  maxAgeDays = 90,
): boolean {
  if (latestConsentTs === null) return false

  const consentTime = new Date(latestConsentTs).getTime()
  if (Number.isNaN(consentTime)) return false

  const ageMs = now.getTime() - consentTime
  return ageMs <= maxAgeDays * MS_PER_DAY
}
