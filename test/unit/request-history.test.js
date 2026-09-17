import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { record, getAll, getStats, reset } from '../../src/store/request-history.js'

const INCIDENT_ROUTE = '/api/data/v9.2/incidents({id})'

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

    test('should clear the request totals and times', () => {
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })
      reset()

      expect(getStats()).toEqual({
        total: 0,
        firstRequestAt: null,
        lastRequestAt: null,
        byRoute: []
      })
    })
  })

  describe('#getStats', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    test('should report no requests and null times when nothing has been recorded', () => {
      expect(getStats()).toEqual({
        total: 0,
        firstRequestAt: null,
        lastRequestAt: null,
        byRoute: []
      })
    })

    test('should count requests to different paths on the same route pattern together', () => {
      record({ method: 'PATCH', endpoint: '/api/data/v9.2/incidents(1)', route: INCIDENT_ROUTE, requestBody: {}, responseStatus: 204 })
      record({ method: 'PATCH', endpoint: '/api/data/v9.2/incidents(2)', route: INCIDENT_ROUTE, requestBody: {}, responseStatus: 204 })

      const stats = getStats()
      expect(stats.total).toBe(2)
      expect(stats.byRoute).toEqual([
        { method: 'PATCH', route: INCIDENT_ROUTE, status: 204, count: 2 }
      ])
    })

    test('should count a different method or status on the same route separately', () => {
      record({ method: 'PATCH', endpoint: '/api/data/v9.2/incidents(1)', route: INCIDENT_ROUTE, requestBody: {}, responseStatus: 204 })
      record({ method: 'PATCH', endpoint: '/api/data/v9.2/incidents(1)', route: INCIDENT_ROUTE, requestBody: {}, responseStatus: 412 })
      record({ method: 'GET', endpoint: '/api/data/v9.2/incidents(1)', route: INCIDENT_ROUTE, requestBody: null, responseStatus: 204 })

      expect(getStats().byRoute).toEqual([
        { method: 'PATCH', route: INCIDENT_ROUTE, status: 204, count: 1 },
        { method: 'PATCH', route: INCIDENT_ROUTE, status: 412, count: 1 },
        { method: 'GET', route: INCIDENT_ROUTE, status: 204, count: 1 }
      ])
    })

    test('should group by endpoint when no route pattern is given', () => {
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })

      expect(getStats().byRoute).toEqual([
        { method: 'GET', route: '/contacts', status: 200, count: 2 }
      ])
    })

    test('should not add the route pattern to the history entry', () => {
      record({ method: 'PATCH', endpoint: '/api/data/v9.2/incidents(1)', route: INCIDENT_ROUTE, requestBody: {}, responseStatus: 204 })

      expect(getAll({ since: new Date(0) })[0]).not.toHaveProperty('route')
    })

    test('should keep counting after the history evicts its oldest entries', async () => {
      const { config } = await import('#/config.js')
      const maxSize = config.get('requestHistory.maxSize')

      for (let i = 0; i <= maxSize; i++) {
        record({ method: 'POST', endpoint: '/api/data/v9.2/$batch', requestBody: null, responseStatus: 200 })
      }

      expect(getAll({ since: new Date(0) })).toHaveLength(maxSize)
      expect(getStats().total).toBe(maxSize + 1)
      expect(getStats().byRoute[0].count).toBe(maxSize + 1)
    })

    test('should report the times of the first and last requests', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'))
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })
      vi.setSystemTime(new Date('2026-09-17T10:01:00.000Z'))
      record({ method: 'GET', endpoint: '/accounts', requestBody: null, responseStatus: 200 })
      vi.setSystemTime(new Date('2026-09-17T10:02:00.000Z'))
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })

      const stats = getStats()
      expect(stats.firstRequestAt).toBe('2026-09-17T10:00:00.000Z')
      expect(stats.lastRequestAt).toBe('2026-09-17T10:02:00.000Z')
    })

    test('should not change the stored totals when the returned stats are modified', () => {
      record({ method: 'GET', endpoint: '/contacts', requestBody: null, responseStatus: 200 })

      getStats().byRoute[0].count = 99

      expect(getStats().byRoute[0].count).toBe(1)
    })
  })
})
