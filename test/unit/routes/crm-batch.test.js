import { readFileSync } from 'node:fs'
import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from '../../../src/server.js'
import {
  getEntity,
  hasEntity,
  resetEntities,
  upsertEntity
} from '../../../src/store/entities.js'
import {
  getStats,
  reset as resetRequestHistory
} from '../../../src/store/request-history.js'

const BATCH_URL = '/api/data/v9.2/$batch'
const CRLF = '\r\n'

// Output of buildChangesetRequest in fcp-sfd-crm; see test/unit/odata-batch.test.js.
const fixture = readFileSync(
  new URL('../../fixtures/consumer-changeset.txt', import.meta.url),
  'utf8'
)
const FIXTURE_CONTENT_TYPE =
  'multipart/mixed;boundary=batch_0f0f0f0f-0000-4000-8000-000000000001'

const CASE_ID = '11111111-1111-4111-8111-111111111111'
const ONLINE_SUBMISSION_ID = '22222222-2222-4222-8222-222222222222'
const METADATA_ID = '33333333-3333-4333-8333-333333333333'

// From parseBatchResponse in fcp-sfd-crm (src/repos/dataverse-batch.js).
const CONSUMER_CHANGESET_BOUNDARY_PATTERN =
  /boundary=(changesetresponse_[0-9a-f-]+)/i

const IF_NONE_MATCH_LINE = `If-None-Match: *${CRLF}`

const withoutLastIfNoneMatch = (body) => {
  const index = body.lastIndexOf(IF_NONE_MATCH_LINE)
  return body.slice(0, index) + body.slice(index + IF_NONE_MATCH_LINE.length)
}

const countMatches = (text, pattern) => text.match(pattern)?.length ?? 0

const expectNoRecords = () => {
  expect(hasEntity('incidents', CASE_ID)).toBe(false)
  expect(hasEntity('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID)).toBe(false)
  expect(hasEntity('rpa_activitymetadatas', METADATA_ID)).toBe(false)
}

describe('#crm-batch', () => {
  let server
  let warnings

  beforeAll(async () => {
    server = await createServer()
    server.ext('onPreHandler', (request, h) => {
      const warn = request.logger.warn.bind(request.logger)
      request.logger.warn = (...args) => {
        warnings.push(args)
        return warn(...args)
      }
      return h.continue
    })
    await server.initialize()
  })

  beforeEach(() => {
    resetEntities()
    resetRequestHistory()
    warnings = []
  })

  afterAll(async () => {
    await server.stop()
  })

  const postBatch = (payload, contentType = FIXTURE_CONTENT_TYPE) =>
    server.inject({
      method: 'POST',
      url: BATCH_URL,
      payload,
      headers: { 'content-type': contentType }
    })

  const getHistory = async () =>
    JSON.parse(
      (await server.inject({ method: 'GET', url: '/stub/requests' })).payload
    )

  test('commits the consumer changeset and returns three 204 parts', async () => {
    const response = await postBatch(fixture)

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(
      /^multipart\/mixed; boundary=batchresponse_[0-9a-f-]+/
    )
    expect(CONSUMER_CHANGESET_BOUNDARY_PATTERN.test(response.payload)).toBe(
      true
    )
    expect(countMatches(response.payload, /HTTP\/1\.1 204 No Content/g)).toBe(3)
    expect(response.payload).toContain(
      `/api/data/v9.2/rpa_activitymetadatas(${METADATA_ID})`
    )

    expect(getEntity('incidents', CASE_ID).body).toMatchObject({
      title: 'Document Upload - SBI 123456789'
    })
    expect(
      getEntity('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID).body
    ).toMatchObject({
      'regardingobjectid_incident_rpa_onlinesubmission@odata.bind': `/incidents(${CASE_ID})`
    })
    expect(getEntity('rpa_activitymetadatas', METADATA_ID).body).toMatchObject({
      rpa_name: 'fixture.pdf'
    })
  })

  test('returns outer 412 with one failing part when the changeset is repeated', async () => {
    await postBatch(fixture)
    const recordsBefore = [
      getEntity('incidents', CASE_ID),
      getEntity('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID),
      getEntity('rpa_activitymetadatas', METADATA_ID)
    ].map((entity) => structuredClone(entity))

    const response = await postBatch(fixture)

    expect(response.statusCode).toBe(412)
    expect(response.headers['content-type']).toMatch(
      /^multipart\/mixed; boundary=batchresponse_/
    )
    expect(countMatches(response.payload, /HTTP\/1\.1 \d{3}/g)).toBe(1)
    expect(response.payload).toContain('HTTP/1.1 412 Precondition Failed')
    expect([
      getEntity('incidents', CASE_ID),
      getEntity('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID),
      getEntity('rpa_activitymetadatas', METADATA_ID)
    ]).toEqual(recordsBefore)
  })

  test('returns 412 and creates nothing when only the metadata record exists', async () => {
    upsertEntity('rpa_activitymetadatas', METADATA_ID, {
      rpa_name: 'existing.pdf'
    })

    const response = await postBatch(fixture)

    expect(response.statusCode).toBe(412)
    expect(response.payload).toContain('Content-ID: 3')
    expect(hasEntity('incidents', CASE_ID)).toBe(false)
    expect(hasEntity('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID)).toBe(false)
    expect(getEntity('rpa_activitymetadatas', METADATA_ID).body).toEqual({
      rpa_name: 'existing.pdf'
    })
  })

  test('returns 200 with an empty batch response for a body without CRLF framing', async () => {
    const response = await postBatch(fixture.replaceAll(CRLF, '\n'))

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(
      /^multipart\/mixed; boundary=batchresponse_/
    )
    expect(CONSUMER_CHANGESET_BOUNDARY_PATTERN.test(response.payload)).toBe(
      false
    )
    expect(countMatches(response.payload, /HTTP\/1\.1/g)).toBe(0)
    expectNoRecords()
  })

  test('returns 200 with an empty batch response for an empty body', async () => {
    const response = await postBatch('')

    expect(response.statusCode).toBe(200)
    expect(countMatches(response.payload, /HTTP\/1\.1/g)).toBe(0)
  })

  test.each([
    [
      'a part without If-None-Match: *',
      withoutLastIfNoneMatch(fixture),
      'does not emulate unconditional batch writes'
    ],
    [
      'a part with an If-Match header',
      fixture.replace(
        IF_NONE_MATCH_LINE,
        `${IF_NONE_MATCH_LINE}If-Match: *${CRLF}`
      ),
      'does not emulate unconditional batch writes'
    ],
    [
      'a part that is not PATCH',
      fixture.replace('PATCH http', 'POST http'),
      'only supports PATCH'
    ],
    [
      'a part for an entity set that is not supported',
      fixture.replace(
        `rpa_activitymetadatas(${METADATA_ID})`,
        `contacts(${METADATA_ID})`
      ),
      "entity set 'contacts' is not supported"
    ],
    [
      'a part whose body is not a JSON object',
      fixture.replace(/\{"rpa_name"[^\r]*/, '[]'),
      'body must be a JSON object'
    ]
  ])(
    'returns 400 and commits nothing for %s',
    async (_description, body, message) => {
      const response = await postBatch(body)

      expect(response.statusCode).toBe(400)
      expect(JSON.parse(response.payload).message).toContain(message)
      expectNoRecords()
    }
  )

  test('returns 400, commits nothing and logs a warning without part content for invalid JSON', async () => {
    const response = await postBatch(
      fixture.replace('{"rpa_name":', '{rpa_name:')
    )

    expect(response.statusCode).toBe(400)
    expectNoRecords()
    expect(warnings).toEqual([
      [
        {
          event: {
            action: 'parse_batch',
            outcome: 'failure',
            reason: 'invalid_json'
          }
        },
        expect.any(String)
      ]
    ])
    expect(JSON.stringify(warnings[0])).not.toContain('fixture.pdf')
  })

  test('returns 400 for a changeset the parser does not support', async () => {
    const response = await postBatch(fixture.replace(' HTTP/1.1', ''))

    expect(response.statusCode).toBe(400)
    expect(warnings).toEqual([
      [
        {
          event: {
            action: 'parse_batch',
            outcome: 'failure',
            reason: 'unsupported'
          }
        },
        expect.any(String)
      ]
    ])
    expectNoRecords()
  })

  test('returns 415 for a JSON content type', async () => {
    const response = await server.inject({
      method: 'POST',
      url: BATCH_URL,
      payload: { title: 'not a batch' },
      headers: { 'content-type': 'application/json' }
    })

    expect(response.statusCode).toBe(415)
    expectNoRecords()
  })

  test('records one history entry with each part and its status for a committed changeset', async () => {
    await postBatch(fixture)

    const history = await getHistory()

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      method: 'POST',
      endpoint: BATCH_URL,
      responseStatus: 200
    })
    expect(history[0].requestBody.parts).toHaveLength(3)
    expect(history[0].requestBody.parts[2]).toEqual({
      contentId: '3',
      method: 'PATCH',
      url: `http://fcp-sfd-crm-stub:3001/api/data/v9.2/rpa_activitymetadatas(${METADATA_ID})`,
      entitySet: 'rpa_activitymetadatas',
      id: METADATA_ID,
      headers: { 'content-type': 'application/json', 'if-none-match': '*' },
      body: expect.objectContaining({ rpa_name: 'fixture.pdf' }),
      responseStatus: 204
    })
    expect(
      history[0].requestBody.parts.map((part) => part.responseStatus)
    ).toEqual([204, 204, 204])
  })

  test('records the failing part as 412 and parts not reported as null for a conflict', async () => {
    upsertEntity('rpa_onlinesubmissions', ONLINE_SUBMISSION_ID, {})

    await postBatch(fixture)

    const [entry] = await getHistory()
    expect(entry.responseStatus).toBe(412)
    expect(entry.requestBody.parts.map((part) => part.responseStatus)).toEqual([
      null,
      412,
      null
    ])
  })

  test('records the refused part as 400 for a refused changeset', async () => {
    await postBatch(withoutLastIfNoneMatch(fixture))

    const [entry] = await getHistory()
    expect(entry.responseStatus).toBe(400)
    expect(entry.requestBody.parts.map((part) => part.responseStatus)).toEqual([
      null,
      null,
      400
    ])
  })

  test('records a null request body for a changeset that cannot be parsed', async () => {
    await postBatch(fixture.replace('{"rpa_name":', '{rpa_name:'))

    const [entry] = await getHistory()
    expect(entry).toMatchObject({
      method: 'POST',
      endpoint: BATCH_URL,
      requestBody: null,
      responseStatus: 400
    })
  })

  test('records an empty parts list for a body without CRLF framing', async () => {
    await postBatch(fixture.replaceAll(CRLF, '\n'))

    const [entry] = await getHistory()
    expect(entry).toMatchObject({
      requestBody: { parts: [] },
      responseStatus: 200
    })
  })

  test('counts each $batch request under its route with its outer status', async () => {
    await postBatch(fixture)
    await postBatch(fixture)

    expect(getStats().byRoute).toEqual([
      { method: 'POST', route: BATCH_URL, status: 200, count: 1 },
      { method: 'POST', route: BATCH_URL, status: 412, count: 1 }
    ])
  })
})
