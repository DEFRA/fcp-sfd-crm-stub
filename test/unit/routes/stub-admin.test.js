import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../../../src/server.js'
import { reset as resetRequestHistory } from '../../../src/store/request-history.js'
import { resetIncidents } from '../../../src/store/incidents.js'

describe('#stub-admin', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    resetRequestHistory()
    resetIncidents()
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
})