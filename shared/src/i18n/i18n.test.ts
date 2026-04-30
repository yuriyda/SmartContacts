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
  test('resolves nested keys for both locales', () => {
    expect(t('en', 'field.phones')).toBe('Phones')
    expect(t('ru', 'field.phones')).toBe('Телефоны')
    expect(t('en', 'actions.delete')).toBe('Delete')
    expect(t('ru', 'actions.delete')).toBe('Удалить')
  })
  test('substitutes multiple variables', () => {
    expect(t('en', 'status.contacts_filtered', { filtered: 7, total: 50 })).toBe('7 of 50 contacts')
    expect(t('ru', 'status.contacts_filtered', { filtered: 7, total: 50 })).toBe(
      '7 из 50 контактов',
    )
  })
  test('falls back to dotted path on missing key', () => {
    expect(t('en', 'no.such.deep.key')).toBe('no.such.deep.key')
  })
})
