import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createServer } from '../../../src/server.js'

describe('#health', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('should return 200 OK', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health'
    })

    expect(response.statusCode).toBe(200)
    expect(response.payload).toEqual(JSON.stringify({ message: 'success' }))
  })
})
