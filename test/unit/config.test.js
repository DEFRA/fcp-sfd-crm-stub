import { describe, test, expect, afterEach } from 'vitest'
import { config } from '../../src/config.js'

describe('#config', () => {
  const originalMaxSize = config.get('incidentStore.maxSize')

  afterEach(() => {
    config.set('incidentStore.maxSize', originalMaxSize)
  })

  describe('incidentStore.maxSize', () => {
    test('rejects 0, which would discard every record as it is written', () => {
      config.set('incidentStore.maxSize', 0)

      expect(() => config.validate({ allowed: 'strict' })).toThrow(
        'must be an integer of 1 or more'
      )
    })

    test('rejects a negative value', () => {
      config.set('incidentStore.maxSize', -1)

      expect(() => config.validate({ allowed: 'strict' })).toThrow(
        'must be an integer of 1 or more'
      )
    })

    test('rejects a non-integer value', () => {
      config.set('incidentStore.maxSize', 1.5)

      expect(() => config.validate({ allowed: 'strict' })).toThrow(
        'must be an integer of 1 or more'
      )
    })

    test('accepts the smallest usable value', () => {
      config.set('incidentStore.maxSize', 1)

      expect(() => config.validate({ allowed: 'strict' })).not.toThrow()
    })
  })
})
