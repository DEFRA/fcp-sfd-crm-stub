import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../../../src/server.js'
import { reset as resetRequestHistory } from '../../../src/store/request-history.js'
import {
  hasEntity,
  resetEntities
} from '../../../src/store/entities.js'

describe('#stub-admin', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    resetRequestHistory()
    resetEntities()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('returns empty array when request history is empty', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/stub/requests'
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual([])
  })

  test('returns recorded CRM requests in order with expected fields', async () => {
    await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/contacts?$select=contactid&$filter=rpa_capcustomerid eq '2024001'"
    })

    await server.inject({
      method: 'POST',
      url: '/api/data/v9.2/incidents',
      payload: {
        title: 'Document Upload - SBI 123456789',
        description: 'Online submission with attached documents'
      }
    })

    const response = await server.inject({
      method: 'GET',
      url: '/stub/requests'
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)

    expect(payload).toHaveLength(2)
    expect(payload[0]).toMatchObject({
      method: 'GET',
      endpoint: '/api/data/v9.2/contacts',
      requestBody: null,
      responseStatus: 200
    })
    expect(payload[0].timestamp).toEqual(expect.any(String))

    expect(payload[1]).toMatchObject({
      method: 'POST',
      endpoint: '/api/data/v9.2/incidents',
      requestBody: {
        title: 'Document Upload - SBI 123456789',
        description: 'Online submission with attached documents'
      },
      responseStatus: 200
    })
    expect(payload[1].timestamp).toEqual(expect.any(String))
  })

  test('reset clears entity records as well as request history', async () => {
    await server.inject({
      method: 'PATCH',
      url: '/api/data/v9.2/incidents(11111111-1111-4111-8111-111111111111)',
      payload: { title: 'Case' },
      headers: { 'if-none-match': '*' }
    })
    await server.inject({
      method: 'PATCH',
      url: '/api/data/v9.2/rpa_activitymetadatas(33333333-3333-4333-8333-333333333333)',
      payload: { rpa_name: 'file.pdf' },
      headers: { 'if-none-match': '*' }
    })

    const resetResponse = await server.inject({
      method: 'POST',
      url: '/stub/reset'
    })

    expect(resetResponse.statusCode).toBe(204)
    expect(hasEntity('incidents', '11111111-1111-4111-8111-111111111111')).toBe(false)
    expect(hasEntity('rpa_activitymetadatas', '33333333-3333-4333-8333-333333333333')).toBe(false)

    const repeatResponse = await server.inject({
      method: 'PATCH',
      url: '/api/data/v9.2/incidents(11111111-1111-4111-8111-111111111111)',
      payload: { title: 'Case' },
      headers: { 'if-none-match': '*' }
    })
    expect(repeatResponse.statusCode).toBe(204)
  })

  test('reset clears request history and returns 204', async () => {
    await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/accounts?$select=accountid&$filter=rpa_sbinumber eq '123456789'"
    })

    const resetResponse = await server.inject({
      method: 'POST',
      url: '/stub/reset'
    })

    expect(resetResponse.statusCode).toBe(204)

    const historyResponse = await server.inject({
      method: 'GET',
      url: '/stub/requests'
    })

    expect(historyResponse.statusCode).toBe(200)
    expect(JSON.parse(historyResponse.payload)).toEqual([])
  })

  test('returns zero totals and null times when nothing has been recorded', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/stub/stats'
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual({
      total: 0,
      firstRequestAt: null,
      lastRequestAt: null,
      byRoute: []
    })
  })

  test('returns totals for recorded CRM requests grouped by route pattern', async () => {
    await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/contacts?$select=contactid&$filter=rpa_capcustomerid eq '2024001'"
    })
    await server.inject({
      method: 'PATCH',
      url: '/api/data/v9.2/incidents(11111111-1111-4111-8111-111111111111)',
      payload: { title: 'Case' },
      headers: { 'if-none-match': '*' }
    })
    await server.inject({
      method: 'PATCH',
      url: '/api/data/v9.2/incidents(22222222-2222-4222-8222-222222222222)',
      payload: { title: 'Case' },
      headers: { 'if-none-match': '*' }
    })

    const response = await server.inject({
      method: 'GET',
      url: '/stub/stats'
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)

    expect(payload.total).toBe(3)
    expect(payload.firstRequestAt).toEqual(expect.any(String))
    expect(payload.lastRequestAt).toEqual(expect.any(String))
    expect(payload.byRoute).toEqual([
      { method: 'GET', route: '/api/data/v9.2/contacts', status: 200, count: 1 },
      { method: 'PATCH', route: '/api/data/v9.2/incidents({id})', status: 204, count: 2 }
    ])
  })

  test('does not count requests to the admin endpoints', async () => {
    await server.inject({ method: 'GET', url: '/stub/requests' })
    await server.inject({ method: 'GET', url: '/stub/stats' })

    const response = await server.inject({
      method: 'GET',
      url: '/stub/stats'
    })

    expect(JSON.parse(response.payload).total).toBe(0)
  })

  test('reset clears request totals', async () => {
    await server.inject({
      method: 'GET',
      url: "/api/data/v9.2/accounts?$select=accountid&$filter=rpa_sbinumber eq '123456789'"
    })

    await server.inject({
      method: 'POST',
      url: '/stub/reset'
    })

    const response = await server.inject({
      method: 'GET',
      url: '/stub/stats'
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual({
      total: 0,
      firstRequestAt: null,
      lastRequestAt: null,
      byRoute: []
    })
  })
})
