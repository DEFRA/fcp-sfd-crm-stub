import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../../../src/server.js'
import {
  CONDITIONAL_UPSERT_ENTITY_SETS,
  getEntity,
  resetEntities
} from '../../../src/store/entities.js'
import { reset as resetRequestHistory } from '../../../src/store/request-history.js'

const WEB_API_PATH = '/api/data/v9.2'
const RECORD_ID = '33333333-3333-4333-8333-333333333333'

describe('#crm-upserts', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  beforeEach(() => {
    resetEntities()
    resetRequestHistory()
  })

  afterAll(async () => {
    await server.stop()
  })

  const patch = (url, payload, headers = {}) =>
    server.inject({ method: 'PATCH', url, payload, headers })

  const conditionalCreate = (url, payload) =>
    patch(url, payload, { 'if-none-match': '*' })

  const getHistory = async () =>
    JSON.parse(
      (await server.inject({ method: 'GET', url: '/stub/requests' })).payload
    )

  describe.each(CONDITIONAL_UPSERT_ENTITY_SETS)('for %s', (entitySet) => {
    const path = `${WEB_API_PATH}/${entitySet}(${RECORD_ID})`

    test('creates a new record with If-None-Match: * and returns 204 with OData-EntityId', async () => {
      const response = await conditionalCreate(path, { rpa_name: 'file.pdf' })

      expect(response.statusCode).toBe(204)
      expect(response.payload).toBe('')
      expect(response.headers['odata-entityid']).toMatch(
        new RegExp(
          `^https?://[^/]+${WEB_API_PATH.replaceAll('.', '\\.')}/${entitySet}\\(${RECORD_ID}\\)$`
        )
      )
      expect(getEntity(entitySet, RECORD_ID).body).toEqual({
        rpa_name: 'file.pdf'
      })
    })

    test('returns 412 with a JSON error body when the record already exists', async () => {
      await conditionalCreate(path, { rpa_name: 'original.pdf' })

      const response = await conditionalCreate(path, { rpa_name: 'repeat.pdf' })

      expect(response.statusCode).toBe(412)
      expect(response.headers['content-type']).toMatch(/^application\/json/)
      expect(JSON.parse(response.payload)).toEqual({
        error: {
          code: 'STUB_GENERATED_ERROR',
          message: expect.any(String)
        }
      })
      expect(response.headers['odata-entityid']).toBeUndefined()
      expect(getEntity(entitySet, RECORD_ID).body).toEqual({
        rpa_name: 'original.pdf'
      })
    })

    test('creates then merges without If-None-Match, returning 204 each time', async () => {
      const createResponse = await patch(path, {
        rpa_name: 'file.pdf',
        rpa_blobfileid: 'blob-1'
      })
      const mergeResponse = await patch(path, { rpa_name: 'renamed.pdf' })

      expect(createResponse.statusCode).toBe(204)
      expect(mergeResponse.statusCode).toBe(204)
      expect(mergeResponse.headers['odata-entityid']).toMatch(
        new RegExp(`/${entitySet}\\(${RECORD_ID}\\)$`)
      )
      expect(getEntity(entitySet, RECORD_ID).body).toEqual({
        rpa_name: 'renamed.pdf',
        rpa_blobfileid: 'blob-1'
      })
    })
  })

  test('returns 404 for an entity set that is not supported', async () => {
    const response = await conditionalCreate(
      `${WEB_API_PATH}/contacts(${RECORD_ID})`,
      {
        firstname: 'Test'
      }
    )

    expect(response.statusCode).toBe(404)
  })

  test.each([
    ['an array', '[]'],
    ['a string', '"text"'],
    ['a number', '1'],
    ['null', 'null']
  ])(
    'returns 400 and stores nothing for %s payload',
    async (_description, payload) => {
      const response = await server.inject({
        method: 'PATCH',
        url: `${WEB_API_PATH}/incidents(${RECORD_ID})`,
        payload,
        headers: { 'content-type': 'application/json', 'if-none-match': '*' }
      })

      expect(response.statusCode).toBe(400)
      expect(getEntity('incidents', RECORD_ID)).toBeNull()
    }
  )

  test('returns 400 and stores nothing when If-None-Match is not *', async () => {
    const response = await patch(
      `${WEB_API_PATH}/incidents(${RECORD_ID})`,
      { title: 'case' },
      { 'if-none-match': 'W/"12345"' }
    )

    expect(response.statusCode).toBe(400)
    expect(getEntity('incidents', RECORD_ID)).toBeNull()
  })

  test('returns 400 and stores nothing when If-Match is sent', async () => {
    const response = await patch(
      `${WEB_API_PATH}/incidents(${RECORD_ID})`,
      { title: 'case' },
      { 'if-match': '*' }
    )

    expect(response.statusCode).toBe(400)
    expect(getEntity('incidents', RECORD_ID)).toBeNull()
  })

  test('records each PATCH in request history with its path, body and status', async () => {
    const path = `${WEB_API_PATH}/rpa_activitymetadatas(${RECORD_ID})`

    await conditionalCreate(path, { rpa_name: 'file.pdf' })
    await conditionalCreate(path, { rpa_name: 'file.pdf' })

    const history = await getHistory()

    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({
      method: 'PATCH',
      endpoint: path,
      requestBody: { rpa_name: 'file.pdf' },
      responseStatus: 204
    })
    expect(history[1]).toMatchObject({
      method: 'PATCH',
      endpoint: path,
      requestBody: { rpa_name: 'file.pdf' },
      responseStatus: 412
    })
  })
})
