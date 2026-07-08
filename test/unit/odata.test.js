import { describe, test, expect } from 'vitest'
import { parseEqFilter, parseSelect, pickSelected } from '../../src/utils/odata.js'

describe('#odata', () => {
  describe('#parseSelect', () => {
    test('returns null when select is missing', () => {
      expect(parseSelect(undefined)).toBeNull()
    })

    test('returns null when select is not a string', () => {
      expect(parseSelect(12345)).toBeNull()
    })

    test('parses comma-separated field names', () => {
      const result = parseSelect('field1,field2,field3')
      expect(result).toBeInstanceOf(Set)
      expect(result.size).toBe(3)
      expect(result.has('field1')).toBe(true)
      expect(result.has('field2')).toBe(true)
      expect(result.has('field3')).toBe(true)
    })

    test('trims whitespace from field names', () => {
      const result = parseSelect('field1 , field2 , field3')
      expect(result.has('field1')).toBe(true)
      expect(result.has('field2')).toBe(true)
      expect(result.has('field3')).toBe(true)
    })

    test('returns null when select string is empty', () => {
      expect(parseSelect('')).toBeNull()
    })
  })

  describe('#parseEqFilter', () => {
    test('returns null when filter is missing', () => {
      expect(parseEqFilter(undefined, 'rpa_capcustomerid')).toBeNull()
    })

    test('returns null when filter is not a string', () => {
      expect(parseEqFilter(12345, 'rpa_capcustomerid')).toBeNull()
    })

    test('extracts value from eq filter', () => {
      const result = parseEqFilter("rpa_capcustomerid eq '12345'", 'rpa_capcustomerid')
      expect(result).toBe('12345')
    })

    test('handles escaped single quotes in value', () => {
      const result = parseEqFilter("fieldname eq 'it''s a value'", 'fieldname')
      expect(result).toBe("it's a value")
    })

    test('returns null when fieldname does not match', () => {
      const result = parseEqFilter("rpa_capcustomerid eq '12345'", 'different_field')
      expect(result).toBeNull()
    })

    test('returns null when filter format is invalid', () => {
      const result = parseEqFilter("rpa_capcustomerid ne '12345'", 'rpa_capcustomerid')
      expect(result).toBeNull()
    })
  })

  describe('#pickSelected', () => {
    test('returns full record when selectedFields is null', () => {
      const record = { id: 1, name: 'test', value: 'data' }
      expect(pickSelected(record, null)).toEqual(record)
    })

    test('returns only selected fields', () => {
      const record = { id: 1, name: 'test', value: 'data' }
      const selected = new Set(['id', 'name'])
      const result = pickSelected(record, selected)
      expect(result).toEqual({ id: 1, name: 'test' })
      expect(result.value).toBeUndefined()
    })

    test('returns empty object when no fields are selected', () => {
      const record = { id: 1, name: 'test' }
      const selected = new Set(['nonexistent'])
      const result = pickSelected(record, selected)
      expect(result).toEqual({})
    })
  })
})