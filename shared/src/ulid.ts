// ULID generator (Universally Unique Lexicographically Sortable Identifier).
// 48-bit timestamp (ms) + 80-bit random entropy, encoded as Crockford Base32, 26 chars.
// Monotonic: within the same millisecond the random part is incremented rather than re-randomised.
// This file is self-contained (no external dependencies) and safe to import in any environment.

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford Base32

// Encode a 5-bit value (0–31) to its Crockford Base32 character.
// The non-null assertion is safe because val is always in [0, 31].
function encodeChar(val: number): string {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return ENCODING[val]!
}

let _lastTime = 0
const _lastRandom = new Array<number>(16).fill(0) // 80 bits = 16 × 5-bit digits

export function ulid(): string {
  const now = Date.now()
  if (now === _lastTime) {
    // Increment random part (carry propagation, most-significant digit last)
    for (let i = 15; i >= 0; i--) {
      const cur = _lastRandom[i] ?? 0
      if (cur < 31) {
        _lastRandom[i] = cur + 1
        break
      }
      _lastRandom[i] = 0 // carry
    }
  } else {
    _lastTime = now
    for (let i = 0; i < 16; i++) _lastRandom[i] = (Math.random() * 32) | 0
  }

  // Encode timestamp (10 chars, most significant first)
  let t = now
  const time = new Array<string>(10)
  for (let i = 9; i >= 0; i--) {
    time[i] = encodeChar(t & 31)
    t = Math.floor(t / 32)
  }

  // Encode random part (16 chars).
  // .map types `v` as `number` (no ?? 0 needed): `_lastRandom` is fixed length 16 of `number`.
  const rand = _lastRandom.map((v) => encodeChar(v)).join('')
  return time.join('') + rand
}
