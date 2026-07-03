import { describe, test, expect, beforeEach } from 'vitest'
import { record, getAll, reset } from '../../src/store/request-history.js'

describe('#request-history', () => {
  beforeEach(() => {
    reset()
  })

  describe('#record', () => {
    test('should store an entry with a timestamp', () => {
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })

      const entries = getAll({ since: new Date(0) })
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        method: 'GET',
        endpoint: '/contacts',
        requestBody: null,
        responseStatus: 200
      })
      expect(entries[0].timestamp).toBeDefined()
    })

    test('should evict the oldest entry when max size is exceeded', async () => {
      const { config } = await import('#/config.js')
      const maxSize = config.get('requestHistory.maxSize')

      for (let i = 0; i <= maxSize; i++) {
        record({ method: 'GET', endpoint: `/endpoint-${i}`, requestBody: null, responseStatus: 200 })
      }

      const entries = getAll({ since: new Date(0) })
      expect(entries).toHaveLength(maxSize)
      expect(entries[0].endpoint).toBe('/endpoint-1')
    })
  })

  describe('#getAll', () => {
    test('should return entries within the default time window', () => {
      record({ method: 'POST', endpoint: '/incidents', requestBody: {}, responseStatus: 200 })

      const entries = getAll()
      expect(entries).toHaveLength(1)
    })

    test('should return all entries when since is new Date(0)', () => {
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })
      record({ method: 'GET', endpoint: '/accounts', requestBody: null, responseStatus: 200 })

      const entries = getAll({ since: new Date(0) })
      expect(entries).toHaveLength(2)
    })

    test('should exclude entries older than the since date', () => {
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })

      const future = new Date(Date.now() + 60_000)
      const entries = getAll({ since: future })
      expect(entries).toHaveLength(0)
    })

    test('should return empty array when no entries recorded', () => {
      expect(getAll({ since: new Date(0) })).toEqual([])
    })
  })

  describe('#reset', () => {
    test('should clear all entries', () => {
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })
      reset()

      expect(getAll({ since: new Date(0) })).toHaveLength(0)
    })
  })
})
