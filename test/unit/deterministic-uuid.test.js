import { describe, test, expect } from 'vitest'
import { deterministicUuid } from '../../src/utils/deterministic-uuid.js'

describe('#deterministicUuid', () => {
  test('should return the same UUID for the same input', () => {
    expect(deterministicUuid('123456789')).toBe(deterministicUuid('123456789'))
  })

  test('should return different UUIDs for different inputs', () => {
    expect(deterministicUuid('111111111')).not.toBe(deterministicUuid('999999999'))
  })

  test('should return a UUID-shaped string (8-4-4-4-12 hex)', () => {
    const result = deterministicUuid('abc')
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  test('should coerce non-string input to string', () => {
    expect(deterministicUuid(123456789)).toBe(deterministicUuid('123456789'))
  })
})
