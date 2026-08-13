import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../../../src/server.js'

describe('#oauth-token', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('returns an OAuth token for a client credentials request', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/oauth2/v2.0/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: new URLSearchParams({
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        grant_type: 'client_credentials',
        scope: 'https://test.crm/.default'
      }).toString()
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual({
      access_token: 'stub-access-token',
      token_type: 'Bearer',
      expires_in: 3600
    })
  })

  test('rejects unsupported grant types', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/oauth2/v2.0/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: new URLSearchParams({
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        grant_type: 'authorization_code',
        scope: 'https://test.crm/.default'
      }).toString()
    })

    expect(response.statusCode).toBe(400)
  })
})
