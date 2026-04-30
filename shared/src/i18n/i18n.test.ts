// Tests for the i18n helper: per-locale lookup, variable substitution, missing-key fallback.
import { describe, expect, test } from 'vitest'
import { t } from './index'

describe('i18n', () => {
  test('returns the right string per locale and substitutes variables', () => {
    expect(t('en', 'status.contacts', { count: 3 })).toBe('3 contacts')
    expect(t('ru', 'status.contacts', { count: 3 })).toBe('3 контактов')
  })
  test('returns the dotted path itself when the key is missing', () => {
    expect(t('en', 'no.such.key')).toBe('no.such.key')
  })
})
