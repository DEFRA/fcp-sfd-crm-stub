import { describe, test, expect } from 'vitest'
import { parseEqFilter, parseSelect } from '../../src/utils/odata.js'

describe('#odata', () => {
  describe('#parseSelect', () => {
    test('returns null when select is missing', () => {
      expect(parseSelect(undefined)).toBeNull()
    })

    test('returns null when select is not a string', () => {
      expect(parseSelect(12345)).toBeNull()
    })
  })

  describe('#parseEqFilter', () => {
    test('returns null when filter is missing', () => {
      expect(parseEqFilter(undefined, 'rpa_capcustomerid')).toBeNull()
    })

    test('returns null when filter is not a string', () => {
      expect(parseEqFilter(12345, 'rpa_capcustomerid')).toBeNull()
    })
  })
})