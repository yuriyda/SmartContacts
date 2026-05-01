/**
 * @file undoCapacity.ts
 * Pure helper for capped-stack push logic used by the undo store.
 * Spec §20.1.
 *
 * Rules:
 *  - No React, no DOM, no side-effects.
 *  - capacity <= 0 treated as 0 (always returns empty array).
 *  - Extract here so unit tests can run in shared/vitest without React.
 */

/**
 * Appends `item` to a copy of `stack`, then trims the oldest entries
 * so that the result length never exceeds `capacity`.
 *
 * Edge cases:
 *  - capacity 0 → always returns [] (item is immediately evicted).
 *  - capacity < 0 → clamped to 0, same behaviour.
 */
export function pushWithCapacity<T>(stack: ReadonlyArray<T>, item: T, capacity: number): T[] {
  const next = [...stack, item]
  const cap = Math.max(0, capacity)
  return next.length > cap ? next.slice(next.length - cap) : next
}
